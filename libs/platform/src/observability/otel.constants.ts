/**
 * Centralized OpenTelemetry metric name and attribute key constants.
 *
 * Using constants prevents typos and makes it easy to search all metric usages.
 * Organized by domain — add new metrics here first before using them in code.
 */

// ── Metric names ────────────────────────────────────────────────────────────

export const OTEL_METRICS = {
  // Auth domain
  AUTH: {
    LOGIN_TOTAL: 'auth.login.total',
    LOGIN_FAILURE_TOTAL: 'auth.login.failure.total',
    LOGOUT_TOTAL: 'auth.logout.total',
    TOKEN_REFRESH_TOTAL: 'auth.token.refresh.total',
    PASSWORD_RESET_TOTAL: 'auth.password.reset.total',
    SESSION_ACTIVE: 'auth.session.active',
  },

  // Work-items domain
  WORK_ITEMS: {
    CREATED_TOTAL: 'work_items.created.total',
    UPDATED_TOTAL: 'work_items.updated.total',
    DELETED_TOTAL: 'work_items.deleted.total',
    MOVED_TOTAL: 'work_items.moved.total',
  },

  // Tenancy domain
  TENANCY: {
    WORKSPACE_CREATED_TOTAL: 'tenancy.workspace.created.total',
    MEMBER_INVITED_TOTAL: 'tenancy.member.invited.total',
    MEMBER_JOINED_TOTAL: 'tenancy.member.joined.total',
  },

  // Outbox relay
  OUTBOX: {
    RELAY_BATCH_TOTAL: 'outbox.relay.batch.total',
    RELAY_EVENT_TOTAL: 'outbox.relay.event.total',
    RELAY_FAILURE_TOTAL: 'outbox.relay.failure.total',
    RELAY_DURATION_MS: 'outbox.relay.duration.ms',
  },

  // HTTP layer
  HTTP: {
    REQUEST_DURATION_MS: 'http.request.duration.ms',
    REQUEST_TOTAL: 'http.request.total',
    ERROR_TOTAL: 'http.error.total',
  },

  // Database
  DB: {
    QUERY_DURATION_MS: 'db.query.duration.ms',
    ERROR_TOTAL: 'db.query.error.total',
  },
} as const;

// ── Attribute key names ──────────────────────────────────────────────────────

export const OTEL_ATTRIBUTES = {
  // Identity
  TENANT_ID: 'app.tenant.id',
  USER_ID: 'app.user.id',
  SESSION_ID: 'app.session.id',
  CORRELATION_ID: 'app.correlation.id',

  // HTTP
  HTTP_ROUTE: 'http.route',
  HTTP_METHOD: 'http.method',
  HTTP_STATUS_CODE: 'http.status_code',

  // Domain
  WORK_ITEM_ID: 'app.work_item.id',
  WORKSPACE_ID: 'app.workspace.id',
  PROJECT_ID: 'app.project.id',

  // Outbox
  OUTBOX_EVENT_TYPE: 'app.outbox.event_type',
  OUTBOX_BATCH_SIZE: 'app.outbox.batch_size',

  // Error
  ERROR_TYPE: 'error.type',
  ERROR_MESSAGE: 'error.message',
} as const;
