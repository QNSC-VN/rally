export * from './health.controller';
/**
 * These now live in `@qnsc-vn/observability`, re-exported here so the existing
 * `@platform` import sites stay valid — the same reason `context/request-context.ts`
 * is a re-export. The package is the single implementation; this is the façade.
 */
export {
  Span,
  type SpanOptions,
  failOpenLog,
  FAIL_OPEN_FIELD,
  type FailOpenControl,
  currentTraceparent,
  withRestoredTrace,
  IGNORED_REQUEST_PATHS,
} from '@qnsc-vn/observability';
