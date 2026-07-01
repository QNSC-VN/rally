import { generateId } from '../ids/uuid';

/**
 * Base DomainEvent interface.
 * All events are versioned contracts — payload shape must not change silently.
 * Carry tenant context for downstream consumer routing + RLS.
 */
export interface DomainEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly version: number;
  readonly occurredAt: Date;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly tenantId: string;
  readonly payload: Record<string, unknown>;
}

export abstract class BaseDomainEvent implements DomainEvent {
  readonly eventId: string;
  readonly occurredAt: Date;

  constructor(
    readonly eventType: string,
    readonly version: number,
    readonly aggregateType: string,
    readonly aggregateId: string,
    readonly tenantId: string,
    readonly payload: Record<string, unknown>,
  ) {
    this.eventId = generateId();
    this.occurredAt = new Date();
  }
}
