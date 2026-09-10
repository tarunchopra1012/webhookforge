/**
 * Values shared across layers that are not configuration.
 *
 * Anything environment-dependent belongs in `src/utils/config.ts` — this
 * file is for constants that are the same in every environment.
 */

/**
 * Reflect metadata keys. `@Api()` writes them; the API-key guard reads them.
 *
 * Kept here rather than next to either side so the two cannot drift: a guard
 * reading a key nobody sets fails open, which on an ingest API means an
 * unauthenticated write.
 */
export const METADATA = Object.freeze({
  /** Set by `@Api({ isPublic: true })`. The guard skips authentication. */
  IS_PUBLIC_KEY: 'isPublic',
});

export const REGEX = Object.freeze({
  /**
   * Subscriber endpoints must be https. Plain http would put a tenant's
   * signed payload on the wire in clear text, and the HMAC only proves
   * authenticity, not confidentiality.
   */
  HTTPS_URL: /^https:\/\/[^\s/$.?#].[^\s]*$/i,
  /** Dotted lowercase event names: `order.created`, `invoice.payment_failed`. */
  EVENT_TYPE: /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
  /** Client-supplied idempotency keys: printable, bounded, no whitespace. */
  IDEMPOTENCY_KEY: /^[A-Za-z0-9._:-]{8,255}$/,
  /** Issued API keys: a readable prefix plus 32 bytes of base64url. */
  API_KEY: /^wf_(live|test)_[A-Za-z0-9_-]{43}$/,
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_LIMIT = 20;
/** Hard ceiling. A tenant asking for 10,000 rows gets 100. */
export const MAX_PAGE_LIMIT = 100;

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export const SWAGGER_PATH = 'api';
export const DEFAULT_API_VERSION = '1';
/** Header carrying the tenant's API key on the ingest and management APIs. */
export const API_KEY_HEADER = 'x-api-key';
/** Headers sent with every outbound delivery. */
export const SIGNATURE_HEADER = 'x-webhookforge-signature';
export const SIGNATURE_TIMESTAMP_HEADER = 'x-webhookforge-timestamp';
export const DELIVERY_ID_HEADER = 'x-webhookforge-delivery-id';

// ---------------------------------------------------------------------------
// Swagger sample values
//
// Fixed literals, never generated. The reference codebase calls randomUUID()
// here, which makes the emitted OpenAPI document differ on every boot and
// turns any spec diff into noise.
// ---------------------------------------------------------------------------

export const SAMPLE_UUID = '3f1a6c2e-9b47-4d8a-b0f5-2c7e1d9a4b63';
export const SAMPLE_EMAIL = 'ops@example.com';
export const SAMPLE_NAME = 'Acme Payments';
export const SAMPLE_URL = 'https://example.com/webhooks/inbound';
export const SAMPLE_EVENT_TYPE = 'order.created';
export const SAMPLE_EVENT_TYPES = ['order.created', 'order.cancelled'];
export const SAMPLE_IDEMPOTENCY_KEY = 'evt_01HQ8Z2K4M9N3P5R7T9V1X3Z';
export const SAMPLE_ISO_DATE = '2026-01-15T09:30:00.000Z';
export const SAMPLE_INT = 13;
export const SAMPLE_DECIMAL = 12.34;
export const SAMPLE_JSON_PAYLOAD = Object.freeze({
  orderId: 'ord_1042',
  total: 4999,
  currency: 'usd',
});

/**
 * Illustrative only — not a key that has ever existed. Real keys are shown
 * once at creation time and stored hashed.
 */
export const SAMPLE_API_KEY = 'wf_test_0000000000000000000000000000000000000000000';
export const SAMPLE_SIGNATURE =
  'sha256=0000000000000000000000000000000000000000000000000000000000000000';
