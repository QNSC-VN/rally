/**
 * AbstractOutboxRelay — generic base class for all transactional outbox relay services.
 *
 * Encapsulates the polling machinery that is identical across every outbox-style
 * relay (email, notifications, webhooks, push, …):
 *   - Concurrency coalescing (see relay()'s doc comment for the exact contract)
 *   - SELECT … FOR UPDATE SKIP LOCKED inside a DB transaction
 *   - Per-row try/catch with attempt counter and status update
 *   - Post-commit task execution (Valkey pub/sub publishes, etc.)
 *
 * Subclasses provide only domain-specific behaviour:
 *   - fetchBatch()   → SELECT from their specific outbox table
 *   - processRow()   → send email / dispatch notification / fire webhook / …
 *   - markSent()     → UPDATE row status to 'sent'
 *   - markFailed()   → UPDATE row status + attempts + last_error
 *
 * Post-commit tasks:
 *   processRow() may return a PostCommitTask (() => Promise<void>).
 *   The base class runs it AFTER the transaction commits so downstream consumers
 *   (SSE, push channels) never receive an event before the DB write is durable.
 *   Returning undefined/void means no post-commit work.
 *
 * Adding a new relay (e.g., webhook delivery):
 *   1. Create a DB outbox table and Drizzle schema entry.
 *   2. Extend AbstractOutboxRelay<WebhookRow>.
 *   3. Implement the 4 abstract methods.
 *   4. Decorate the relay() override with @Cron + @Span.
 *   5. Register the class as a provider in the Worker module.
 *
 * Usage:
 *   @Injectable()
 *   export class WebhookRelayService extends AbstractOutboxRelay<WebhookRow> {
 *     constructor(@InjectDrizzle() db: DrizzleDB, private readonly http: HttpService) {
 *       super(db);
 *     }
 *
 *     @Cron('* /5 * * * * *', { name: 'webhook-relay' })
 *     @Span('webhook.relay')
 *     override async relay(): Promise<void> { return super.relay(); }
 *
 *     protected async fetchBatch(tx: DrizzleTx): Promise<WebhookRow[]> { ... }
 *     protected async processRow(row: WebhookRow): Promise<PostCommitTask | void> { ... }
 *     protected async markSent(tx: DrizzleTx, rowId: string): Promise<void> { ... }
 *     protected async markFailed(...): Promise<void> { ... }
 *   }
 */
import { Logger } from '@nestjs/common';
import type { DrizzleDB, DrizzleTx } from '../database/drizzle.provider';

/** Optional callback returned by processRow() to run after the transaction commits. */
export type PostCommitTask = () => Promise<void>;

export abstract class AbstractOutboxRelay<TRow extends { id: string; attempts: number }> {
  /** Override in subclass to tune per-relay. */
  protected readonly maxAttempts: number = 5;
  protected readonly batchSize: number = 50;

  protected readonly logger: Logger;
  /** The currently in-flight pass, or null when idle. */
  private inFlight: Promise<void> | null = null;
  /**
   * A pass queued to start once `inFlight` finishes, shared by every caller
   * that arrived while busy — set only once per in-flight pass (coalesces a
   * burst of N racing calls into exactly one extra pass, not N).
   */
  private queued: Promise<void> | null = null;

  constructor(protected readonly db: DrizzleDB) {
    // Logger name is the concrete subclass name for precise log attribution.
    this.logger = new Logger(this.constructor.name);
  }

  // ── Abstract interface ────────────────────────────────────────────────────

  /**
   * SELECT a locked batch of pending rows from the outbox table.
   * MUST use the provided transaction and include FOR UPDATE SKIP LOCKED.
   */
  protected abstract fetchBatch(tx: DrizzleTx): Promise<TRow[]>;

  /**
   * Process one row — the domain-specific side effect (send email, fire webhook…).
   *
   * May return a PostCommitTask: a callback that runs AFTER the surrounding DB
   * transaction commits.  Useful for pub/sub publishes that must not fire before
   * the DB write is durable (e.g., Valkey → SSE push for notifications).
   *
   * Return undefined/void when there is no post-commit work.
   */
  protected abstract processRow(row: TRow): Promise<PostCommitTask | void>;

  /** Mark the row as successfully processed (within the relay transaction). */
  protected abstract markSent(tx: DrizzleTx, rowId: string): Promise<void>;

  /**
   * Mark the row as failed or pending-retry (within the relay transaction).
   * newStatus is 'failed' when newAttempts >= maxAttempts, otherwise 'pending'.
   *
   * `nextAttemptAt` is the base class's computed exponential-backoff delay
   * (see {@link backoffDelayMs}) — subclasses whose outbox table has a
   * `scheduledAt`/similar column should write it there so `fetchBatch()`'s
   * `scheduledAt <= now()` filter actually spaces retries out. Subclasses
   * without such a column (e.g. the SNS domain-event outbox, which retries
   * every tick unconditionally) may ignore it.
   */
  protected abstract markFailed(
    tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    lastError: string,
    nextAttemptAt: Date,
  ): Promise<void>;

  /**
   * Exponential backoff with a cap, so a persistently-failing row is retried
   * with increasing spacing instead of burning all `maxAttempts` within
   * seconds (bounded only by the cron/wake cadence). Base 30s, doubling per
   * attempt, capped at 30 minutes: attempt 1 → 30s, 2 → 1m, 3 → 2m, 4 → 4m,
   * 5 → 8m (well under the cap for the default maxAttempts=5).
   */
  protected backoffDelayMs(newAttempts: number): number {
    const baseMs = 30_000;
    const capMs = 30 * 60_000;
    return Math.min(baseMs * 2 ** (newAttempts - 1), capMs);
  }

  // ── Relay loop ────────────────────────────────────────────────────────────

  /**
   * Core relay loop — called by the subclass @Cron handler (and optionally by
   * pub/sub wake signals for near-zero latency dispatch).
   *
   * Subclasses MUST override relay() and add @Cron + @Span decorators for a
   * unique cron name and trace span:
   *
   *   @Cron('* /5 * * * * *', { name: 'my-relay' })
   *   @Span('my.relay')
   *   override async relay(): Promise<void> { return super.relay(); }
   *
   * Concurrency contract: relay() never no-ops. Calling it while a pass is
   * already in flight does not start a second, overlapping pass (fetchBatch's
   * FOR UPDATE SKIP LOCKED already makes that safe, but running two at once
   * would just contend for the same rows) — instead, ALL callers that arrive
   * while busy share one pass queued to start immediately after the current
   * one finishes, and every caller's promise resolves only when a pass that
   * began at or after their own call has completed. A write made just before
   * calling relay() is therefore always visible to the pass that caller's
   * await resolves on — there is no timing window where relay() returns
   * having silently done nothing. (The previous design set a boolean flag and
   * returned immediately, so a racing caller's promise resolved before any
   * corresponding fetchBatch had run — correct for the production cron/wake
   * callers, who never await the result, but a footgun for anything that
   * does, e.g. tests asserting on the row relay() was just told to process.)
   */
  async relay(): Promise<void> {
    if (this.inFlight) {
      // A pass is already running. Coalesce with whatever's already queued
      // behind it (or start queuing one) so a burst of N racing calls shares
      // exactly one extra pass, not N — but every caller still awaits a pass
      // that starts after their own call, not the one already in flight.
      this.queued ??= this.inFlight.then(() => this.runOnce());
      return this.queued;
    }
    this.inFlight = this.runOnce();
    return this.inFlight;
  }

  /** Runs exactly one fetch-process-mark pass, then hands off to any queued pass. */
  private async runOnce(): Promise<void> {
    // Collect post-commit tasks outside the transaction so they run only after
    // the transaction has durably committed.
    const postCommitTasks: PostCommitTask[] = [];

    try {
      await this.db.transaction(async (tx) => {
        const batch = await this.fetchBatch(tx);
        if (!batch.length) return;

        this.logger.debug(`Relaying ${batch.length} row(s)`);

        for (const row of batch) {
          try {
            const task = await this.processRow(row);
            await this.markSent(tx, row.id);
            if (task) postCommitTasks.push(task);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const newAttempts = row.attempts + 1;
            const newStatus: 'pending' | 'failed' =
              newAttempts >= this.maxAttempts ? 'failed' : 'pending';
            const nextAttemptAt = new Date(Date.now() + this.backoffDelayMs(newAttempts));

            await this.markFailed(tx, row.id, newAttempts, newStatus, errMsg, nextAttemptAt);

            this.logger.error(
              { rowId: row.id, err },
              `Relay failed (attempt ${newAttempts}/${this.maxAttempts})`,
            );
          }
        }
      });

      // Transaction committed — run post-commit tasks (fire-and-forget, non-critical).
      // Errors here do not affect outbox correctness; the row is already marked 'sent'.
      for (const task of postCommitTasks) {
        task().catch((err: unknown) => this.logger.error({ err }, 'Post-commit task failed'));
      }
    } finally {
      // Hand off to the queued pass (if any) BEFORE clearing inFlight, so a
      // caller that arrives in the gap between this pass finishing and the
      // queued one starting still sees a truthy inFlight and coalesces onto
      // the queued pass instead of racing to start a third one. `next` is
      // already running (it was created via `.then()` in relay() above) and
      // already returned to whoever queued it — this .catch() only prevents
      // an unhandled-rejection warning if that caller fired-and-forgot
      // (e.g. the cron's `void this.relay()`) instead of awaiting it.
      const next = this.queued;
      this.queued = null;
      this.inFlight = next;
      next?.catch((err: unknown) => this.logger.error({ err }, 'Queued relay pass failed'));
    }
  }
}
