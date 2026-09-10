/**
 * The event vocabulary of the system.
 *
 * Two kinds, and the split matters:
 *
 *   DomainEvent      — something that happened inside this service, published
 *                      and consumed in-process. Free to fire often; a missed
 *                      one costs a metric or a log line, not correctness.
 *
 *   IntegrationEvent — something that crosses a process boundary: a BullMQ
 *                      job, a notification another service acts on. These
 *                      must survive the transaction that produced them, so
 *                      they are published only *after* commit. Publishing
 *                      one inside a transaction that later rolls back is the
 *                      classic dual-write bug — a worker picks up the job,
 *                      reads the row, and the row is not there.
 *
 * This file declares the vocabulary and the payload shapes only. The
 * publisher lands with the queue module; there is deliberately no emitter
 * wired here yet, so nothing can quietly collect events and drop them.
 *
 * Payloads carry ids and scalars, never whole aggregates. A queued job may
 * run minutes after it was created, and an embedded copy of a Delivery would
 * be a stale copy by then — the worker re-reads through a port instead.
 */

export enum DomainEvent {
  EventIngested = 'event.ingested',
  DeliveryScheduled = 'delivery.scheduled',
  DeliveryAttempted = 'delivery.attempted',
  DeliverySucceeded = 'delivery.succeeded',
  DeliveryFailed = 'delivery.failed',
  DeliveryDeadLettered = 'delivery.deadlettered',
  SubscriptionDeactivated = 'subscription.deactivated',
  ApiKeyRevoked = 'apikey.revoked',
}

export enum IntegrationEvent {
  DeliveryEnqueued = 'delivery.enqueued',
  DeliveryRetryEnqueued = 'delivery.retry.enqueued',
  DeadLetterRecorded = 'deadletter.recorded',
  RetrySweepRequested = 'retry.sweep.requested',
  DeadLetterReplayRequested = 'deadletter.replay.requested',
}

export abstract class BaseDomainEvent {
  constructor(
    readonly eventType: DomainEvent,
    /** Every event is tenant-scoped, so consumers cannot fan out across tenants. */
    readonly tenantId: string,
    readonly occurredAt: Date = new Date(),
  ) {}
}

export abstract class BaseIntegrationEvent {
  constructor(
    readonly eventType: IntegrationEvent,
    readonly tenantId: string,
    readonly occurredAt: Date = new Date(),
  ) {}
}

// ---------------------------------------------------------------------------
// Domain events
// ---------------------------------------------------------------------------

export class EventIngestedEvent extends BaseDomainEvent {
  constructor(
    tenantId: string,
    readonly eventId: string,
    readonly type: string,
    readonly idempotencyKey: string,
    /** How many subscriptions matched. Zero is legitimate and worth seeing. */
    readonly deliveryCount: number,
  ) {
    super(DomainEvent.EventIngested, tenantId);
  }
}

export class DeliveryScheduledEvent extends BaseDomainEvent {
  constructor(
    tenantId: string,
    readonly deliveryId: string,
    readonly eventId: string,
    readonly subscriptionId: string,
  ) {
    super(DomainEvent.DeliveryScheduled, tenantId);
  }
}

export class DeliveryAttemptedEvent extends BaseDomainEvent {
  constructor(
    tenantId: string,
    readonly deliveryId: string,
    readonly attemptNumber: number,
    readonly durationMs: number,
    /** Absent when the attempt failed before a response (timeout, DNS, reset). */
    readonly responseStatus?: number,
  ) {
    super(DomainEvent.DeliveryAttempted, tenantId);
  }
}

export class DeliverySucceededEvent extends BaseDomainEvent {
  constructor(
    tenantId: string,
    readonly deliveryId: string,
    readonly subscriptionId: string,
    readonly attemptCount: number,
  ) {
    super(DomainEvent.DeliverySucceeded, tenantId);
  }
}

export class DeliveryFailedEvent extends BaseDomainEvent {
  constructor(
    tenantId: string,
    readonly deliveryId: string,
    readonly subscriptionId: string,
    readonly attemptCount: number,
    readonly nextAttemptAt: Date,
    readonly reason: string,
  ) {
    super(DomainEvent.DeliveryFailed, tenantId);
  }
}

export class DeliveryDeadLetteredEvent extends BaseDomainEvent {
  constructor(
    tenantId: string,
    readonly deliveryId: string,
    readonly subscriptionId: string,
    readonly attemptCount: number,
    readonly reason: string,
  ) {
    super(DomainEvent.DeliveryDeadLettered, tenantId);
  }
}

export class SubscriptionDeactivatedEvent extends BaseDomainEvent {
  constructor(
    tenantId: string,
    readonly subscriptionId: string,
    readonly reason: string,
  ) {
    super(DomainEvent.SubscriptionDeactivated, tenantId);
  }
}

export class ApiKeyRevokedEvent extends BaseDomainEvent {
  constructor(
    tenantId: string,
    readonly apiKeyId: string,
  ) {
    super(DomainEvent.ApiKeyRevoked, tenantId);
  }
}

// ---------------------------------------------------------------------------
// Integration events
// ---------------------------------------------------------------------------

export class DeliveryEnqueuedEvent extends BaseIntegrationEvent {
  constructor(
    tenantId: string,
    readonly deliveryId: string,
  ) {
    super(IntegrationEvent.DeliveryEnqueued, tenantId);
  }
}

export class DeliveryRetryEnqueuedEvent extends BaseIntegrationEvent {
  constructor(
    tenantId: string,
    readonly deliveryId: string,
    readonly attemptNumber: number,
    /** Delay the queue should honour, already including backoff and jitter. */
    readonly delayMs: number,
  ) {
    super(IntegrationEvent.DeliveryRetryEnqueued, tenantId);
  }
}

export class DeadLetterRecordedEvent extends BaseIntegrationEvent {
  constructor(
    tenantId: string,
    readonly deadLetterId: string,
    readonly deliveryId: string,
  ) {
    super(IntegrationEvent.DeadLetterRecorded, tenantId);
  }
}

export class RetrySweepRequestedEvent extends BaseIntegrationEvent {
  constructor(
    tenantId: string,
    readonly dueBefore: Date,
  ) {
    super(IntegrationEvent.RetrySweepRequested, tenantId);
  }
}

export class DeadLetterReplayRequestedEvent extends BaseIntegrationEvent {
  constructor(
    tenantId: string,
    readonly deadLetterIds: string[],
  ) {
    super(IntegrationEvent.DeadLetterReplayRequested, tenantId);
  }
}
