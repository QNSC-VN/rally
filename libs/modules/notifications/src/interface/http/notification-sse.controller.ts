/**
 * NotificationSseController — Server-Sent Events endpoint for real-time
 * in-app notification delivery.
 *
 * Architecture:
 *   Worker relay writes to in_app_notifications
 *     → publishes to Valkey  notifications:user:{userId}
 *       → NotificationPubSubService delivers message to all subscribed handlers
 *         → this controller writes SSE event to the browser
 *
 * SSE event contract (for the frontend):
 *
 *   Connection established:
 *     event: connected
 *     data: { "unreadCount": <number> }
 *
 *   Replay on reconnect (when Last-Event-ID header is present):
 *     event: notification
 *     id: <notificationId>
 *     data: { "notificationId": "...", "type": "...", "title": "...",
 *             "body": "...", "resourceType": "...", "resourceId": "..." }
 *     (one event per missed notification, oldest first)
 *
 *   New notification dispatched:
 *     event: notification
 *     id: <notificationId>
 *     data: { "notificationId": "...", "type": "...", "title": "...",
 *              "body": "...", "resourceType": "...", "resourceId": "..." }
 *
 *   Heartbeat (every 25s — prevents proxy/LB from closing idle connections):
 *     : heartbeat
 *
 *   Reconnect hint (on server restart / graceful shutdown):
 *     event: reconnect
 *     data: { "retryMs": 3000 }
 *
 * Missed-event replay:
 *   The browser's EventSource API automatically sends the `Last-Event-ID`
 *   request header on reconnect using the last `id:` value it received.
 *   The controller replays all notifications newer than that ID (up to 30)
 *   before entering the live-push phase.  Notifications older than the replay
 *   window are reconciled via the unread-count badge shown on connect.
 *
 * Fastify notes:
 *   reply.hijack() transfers full response ownership to this handler so
 *   Fastify does not interfere with the long-lived streaming response.
 *   reply.raw is the underlying Node.js http.ServerResponse.
 */
import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Auth, ApiCommonErrors } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@modules/identity';
import { NotificationPubSubService } from '@platform/notifications';
import { NotificationsService } from '../../application/notifications.service';

@ApiTags('notifications')
@Controller('notifications')
@Auth()
export class NotificationSseController {
  constructor(
    private readonly pubSub: NotificationPubSubService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Get('stream')
  @ApiOperation({
    summary: 'SSE stream — real-time notification events',
    description:
      'Opens a Server-Sent Events stream.  The client receives a `connected` event ' +
      'with the current unread count, then a `notification` event (with `id:` set) ' +
      'for every new in-app notification.  On reconnect the browser sends ' +
      '`Last-Event-ID` automatically; the server replays missed notifications ' +
      'before entering live-push mode.',
  })
  @ApiResponse({ status: 200, description: 'SSE stream (text/event-stream)' })
  @ApiCommonErrors(401)
  async stream(
    @CurrentUser() user: JwtPayload,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Transfer full response ownership to this handler so Fastify does not
    // attempt to send its own response or close the connection after the
    // async handler returns.
    reply.hijack();

    const raw = reply.raw;
    raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    raw.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    raw.setHeader('Connection', 'keep-alive');
    // Prevents Nginx, Caddy, and AWS ALB from buffering the stream.
    raw.setHeader('X-Accel-Buffering', 'no');
    raw.flushHeaders();

    // Send the current unread count immediately on connect so the client does
    // not need a separate GET /notifications/unread-count round-trip.
    const unreadCount = await this.notificationsService.getUnreadCount(user);
    writeEvent(raw, 'connected', { unreadCount });

    // Replay missed events when the client reconnects with Last-Event-ID.
    // The EventSource API sets this header automatically using the last `id:`
    // value it received.  We replay up to 30 notifications older than the
    // replay window; beyond that the unread-count badge is the reconciliation.
    const lastEventId = req.headers['last-event-id'] as string | undefined;
    if (lastEventId) {
      const missed = await this.notificationsService.listMissed(user, lastEventId);
      for (const n of missed) {
        if (!raw.writable) break;
        writeNotificationEvent(raw, {
          notificationId: n.id,
          recipientId: n.recipientId,
          type: n.type,
          title: n.title,
          body: n.body ?? undefined,
          resourceType: n.resourceType ?? undefined,
          resourceId: n.resourceId ?? undefined,
        });
      }
    }

    // Subscribe to Valkey pub/sub for this user's notifications.
    // Multiple browser tabs / devices each get their own subscription.
    const unsubscribe = await this.pubSub.subscribeUser(user.sub, (payload) => {
      if (raw.writable) {
        writeNotificationEvent(raw, payload);
      }
    });

    // Heartbeat every 25s.
    // - Keeps the TCP connection alive through proxies and load balancers.
    // - The browser's EventSource re-fires the 'open' event if it reconnects.
    // SSE comments ("...") are ignored by EventSource but keep the stream open.
    const heartbeat = setInterval(() => {
      if (!raw.writable) {
        clearInterval(heartbeat);
        return;
      }
      raw.write(': heartbeat\n\n');
    }, 25_000);

    // Graceful cleanup on client disconnect.
    raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe().catch(() => {});
    });
  }
}

interface NotificationPayload {
  notificationId: string;
  recipientId: string;
  type: string;
  title: string;
  body?: string;
  resourceType?: string;
  resourceId?: string;
}

/**
 * Write a `notification` SSE event with an `id:` field so the browser's
 * EventSource tracks the cursor and sends `Last-Event-ID` on reconnect.
 */
function writeNotificationEvent(raw: NodeJS.WritableStream, payload: NotificationPayload): void {
  raw.write(
    `event: notification\nid: ${payload.notificationId}\ndata: ${JSON.stringify(payload)}\n\n`,
  );
}

/** Write a generic typed SSE event (no cursor id — used for `connected`). */
function writeEvent(raw: NodeJS.WritableStream, event: string, data: unknown): void {
  raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
