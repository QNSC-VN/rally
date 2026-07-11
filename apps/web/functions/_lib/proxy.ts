/**
 * Same-origin reverse proxy used by the Cloudflare Pages Functions that front
 * the rally SPA. It forwards `/v1/*` and `/bff/*` from the SPA origin
 * (`rally-dev.qnsc.vn`) to the API origin (`rally-api-dev.qnsc.vn`), so the
 * browser sees a single origin. That is what lets the BFF issue a
 * `__Host-rally_session` cookie with `SameSite=Strict` and drop CORS entirely.
 *
 * The logic here is pure and framework-agnostic (only web-standard `Request` /
 * `Response` / `Headers` / `URL`), so it is unit-testable under the web app's
 * vitest and portable to a standalone Worker if we ever move off Pages.
 *
 * NOTE: this proxy is inert until the SPA is pointed at same-origin `/v1`
 * (increment 4). Today the SPA still calls `rally-api-dev.qnsc.vn` directly, so
 * these paths are never hit on the Pages origin.
 */

/** Hop-by-hop headers that must never cross a proxy boundary (RFC 7230 §6.1). */
const HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/** Methods that never carry a request body. */
const BODILESS_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD'])

/** Rebuild the target URL: keep the incoming path + query, swap in the API origin. */
export function buildUpstreamUrl(requestUrl: string, apiOrigin: string): string {
  const incoming = new URL(requestUrl)
  const upstream = new URL(apiOrigin)
  upstream.pathname = incoming.pathname
  upstream.search = incoming.search
  return upstream.toString()
}

/**
 * Build the request forwarded to the API origin: same method/body, headers with
 * hop-by-hop + `host` stripped, and `X-Forwarded-*` set from the Cloudflare edge
 * so the API's cookie logic (which reads `x-forwarded-proto` and the client IP)
 * behaves as if the request arrived directly.
 */
export function buildProxyRequest(request: Request, apiOrigin: string): Request {
  const url = buildUpstreamUrl(request.url, apiOrigin)
  const headers = new Headers(request.headers)
  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header)
  headers.delete('host')

  const clientIp = request.headers.get('cf-connecting-ip')
  if (clientIp) {
    const existing = headers.get('x-forwarded-for')
    headers.set('x-forwarded-for', existing ? `${existing}, ${clientIp}` : clientIp)
  }
  headers.set('x-forwarded-proto', 'https')
  headers.set('x-forwarded-host', new URL(request.url).host)

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual',
  }
  if (!BODILESS_METHODS.has(request.method.toUpperCase())) {
    init.body = request.body
    init.duplex = 'half' // required when streaming a body (undici/Workers)
  }
  return new Request(url, init)
}

/**
 * Copy the upstream response back to the client, preserving status and every
 * `Set-Cookie` header individually (a naive `new Headers(res.headers)` collapses
 * multiple cookies into one comma-joined value and corrupts them).
 */
export function buildClientResponse(upstream: Response): Response {
  const headers = new Headers()
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') headers.set(key, value)
  })
  const setCookies = upstream.headers.getSetCookie?.() ?? []
  for (const cookie of setCookies) headers.append('set-cookie', cookie)

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}

/**
 * Proxy a request to the API origin. `fetchImpl` is injectable for testing;
 * production passes the platform `fetch`.
 */
export async function proxyToApi(
  request: Request,
  apiOrigin: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!apiOrigin) {
    return new Response('Proxy misconfigured: API_ORIGIN is not set', { status: 500 })
  }
  const upstream = await fetchImpl(buildProxyRequest(request, apiOrigin))
  return buildClientResponse(upstream)
}
