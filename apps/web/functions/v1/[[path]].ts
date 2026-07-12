/**
 * Cloudflare Pages Function: proxy `/v1/*` on the SPA origin to the API origin.
 *
 * Placed under `functions/v1/` (path-scoped) rather than a global
 * `_middleware.ts` so that static asset serving stays on Cloudflare's fast path
 * and is never routed through user code.
 *
 * Requires the Pages project to expose an `API_ORIGIN` environment variable,
 * e.g. `https://rally-api-dev.qnsc.vn`.
 */
import { proxyToApi } from '../_lib/proxy'

interface Env {
  API_ORIGIN?: string
}

type PagesFunction = (context: { request: Request; env: Env }) => Promise<Response>

export const onRequest: PagesFunction = (context) =>
  proxyToApi(context.request, context.env.API_ORIGIN)
