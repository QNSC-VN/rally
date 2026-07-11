/**
 * Cloudflare Pages Function: proxy `/bff/*` on the SPA origin to the API origin.
 *
 * The BFF login/callback/logout/me routes must be same-origin with the SPA so
 * the `__Host-rally_session` cookie is first-party. Path-scoped (see the sibling
 * `functions/v1/` handler) to keep static asset serving untouched.
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
