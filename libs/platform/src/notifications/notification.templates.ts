/**
 * Notification template registry — typed definitions for every in-app notification.
 *
 * Adding a new notification type:
 *   1. Add the name to `NotificationTemplateName`.
 *   2. Add its vars shape to `NotificationTemplateVars`.
 *   3. Add a case to `renderNotification()`.
 *
 * This is the single source of truth.  NotificationSchedulerService enforces
 * the vars shape at the call site (compile-time).  The relay renderer uses this
 * at runtime so template logic never scatters across business services.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationTemplateName = 'WORKSPACE_INVITATION' | 'WORKSPACE_INVITATION_ACCEPTED';

export interface NotificationTemplateVars {
  WORKSPACE_INVITATION: {
    workspaceName: string;
    inviterName: string;
    role: string;
  };
  WORKSPACE_INVITATION_ACCEPTED: {
    workspaceName: string;
    accepteeName: string;
  };
}

/**
 * The rendered output written to in_app_notifications.
 * resourceType is a constant per template (determines the deep-link target).
 * resourceId is dynamic and supplied by the caller via ScheduleNotificationOptions.
 */
export interface RenderedNotification {
  title: string;
  body?: string;
  /** Maps to in_app_notifications.resource_type — constant per template. */
  resourceType?: string;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export function renderNotification<K extends NotificationTemplateName>(
  type: K,
  vars: NotificationTemplateVars[K],
): RenderedNotification {
  switch (type) {
    case 'WORKSPACE_INVITATION': {
      const v = vars as NotificationTemplateVars['WORKSPACE_INVITATION'];
      return {
        title: `${v.inviterName} invited you to ${v.workspaceName}`,
        body: `You've been invited as ${v.role}. Open the notification to accept.`,
        resourceType: 'workspace',
      };
    }
    case 'WORKSPACE_INVITATION_ACCEPTED': {
      const v = vars as NotificationTemplateVars['WORKSPACE_INVITATION_ACCEPTED'];
      return {
        title: `${v.accepteeName} accepted your invitation to ${v.workspaceName}`,
        resourceType: 'workspace',
      };
    }
    default: {
      // Exhaustiveness guard — TS will error if a case is missing.
      const _exhaustive: never = type;
      throw new Error(`Unknown notification template: ${String(_exhaustive)}`);
    }
  }
}
