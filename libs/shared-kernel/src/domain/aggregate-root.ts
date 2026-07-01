import type { DomainEvent } from './domain-event';
import { Entity } from './entity';

/**
 * AggregateRoot — consistency boundary.
 * Collects domain events in-memory; the application layer writes them to the outbox
 * in the same transaction as the aggregate state change.
 */
export abstract class AggregateRoot<TId = string> extends Entity<TId> {
  private _events: DomainEvent[] = [];

  protected addEvent(event: DomainEvent): void {
    this._events.push(event);
  }

  /**
   * Pull and clear pending events.
   * Called by the application layer after persisting the aggregate.
   */
  pullEvents(): DomainEvent[] {
    const events = [...this._events];
    this._events = [];
    return events;
  }

  get hasPendingEvents(): boolean {
    return this._events.length > 0;
  }
}
