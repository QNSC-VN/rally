/**
 * AbstractOutboxRelay — generic base class for all transactional outbox relay services.
 *
 * Encapsulates the polling machinery that is identical across every outbox-style
 * relay (email, notifications, webhooks, push, …):
 *   - Concurrency guard (isRelaying)
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
  private isRelaying = false;
  /**
   * Set to true when relay() is called while isRelaying=true.
   * Guarantees one more relay run after the current one completes so that rows
   * inserted during a long relay batch are not left waiting for the next cron
   * tick (up to 5 s).  Uses setImmediate to avoid stack overflow on bursts.
   */
  private wakeOnComplete = false;

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
   */
  protected abstract markFailed(
    tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    lastError: string,
  ): Promise<void>;

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
   */
  async relay(): Promise<void> {
    if (this.isRelaying) {
      // Record that a wake arrived while the relay was busy so we schedule one
      // more run after the current batch completes.  Without this, rows inserted
      // during a long relay batch would wait up to 5 s for the next cron tick.
      this.wakeOnComplete = true;
      return;
    }
    this.isRelaying = true;

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

            await this.markFailed(tx, row.id, newAttempts, newStatus, errMsg);

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
        task().catch((err) => this.logger.error({ err }, 'Post-commit task failed'));
      }
    } finally {
      this.isRelaying = false;
      // If a wake arrived while we were busy, schedule one more run immediately.
      if (this.wakeOnComplete) {
        this.wakeOnComplete = false;
        setImmediate(() =>
          this.relay().catch((err) => this.logger.error({ err }, 'Post-wake relay failed')),
        );
      }
    }
  }
}
