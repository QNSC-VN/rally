/**
 * Same-origin reverse proxy used by the Cloudflare Pages Function that fronts
 * the rally SPA. It forwards `/v1/*` (which includes the BFF auth routes
 * `/v1/bff/*`) from the SPA origin (`rally-dev.qnsc.vn`) to the API origin
 * (`rally-api-dev.qnsc.vn`), so the browser sees a single origin. That is what
 * lets the BFF issue a `__Host-rally_session` cookie with `SameSite=Strict` and
 * drop CORS entirely.
 *
 * The logic here is pure and framework-agnostic (only web-standard `Request` /
 * `Response` / `Headers` / `URL`), so it is unit-testable under the web app's
 * vitest and portable to a standalone Worker if we ever move off Pages.
 *
 * Requires the Pages project to expose `API_ORIGIN`, e.g.
 * `https://rally-api-dev.qnsc.vn`. The SPA always talks to the API through this
 * same-origin proxy (the BFF flow depends on it).
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

/**
 * Paths whose request body is read to completion at the edge before the origin
 * request starts, instead of being streamed through.
 *
 * Measured, not assumed. `TargetResponseTime` on `POST /v1/scm/webhook/github` is
 * trimodal in production — 243 requests under 50ms, 83 at 0.25-0.5s, and a tail to
 * 27.7s — while the handler runs in 3-10ms throughout. Per-request attribution
 * (`albWaitMs` / `bodyWaitMs` in the API's access log) showed
 * `target_processing_time ~= bodyWaitMs + duration` on every sample, so the wait is
 * REQUEST-BODY RECEIPT: the origin is handed headers and then waits on a body that is
 * still crossing the network.
 *
 * Buffering here collapses that. Synthetic probes whose body Cloudflare happened to
 * hold complete before forwarding recorded 0.004-0.037s on the same route and payload
 * size, against 0.25-27.7s for GitHub's streamed deliveries.
 *
 * Deliberately a narrow allowlist, not a global switch: blanket buffering would pull
 * the SPA's 10 MB multipart uploads into edge memory and add latency to them, to fix
 * a problem only small JSON webhooks have. Response streaming is untouched either way
 * — `buildClientResponse` still passes `upstream.body` straight through, so SSE keeps
 * working.
 */
const BUFFERED_REQUEST_PATH_PREFIXES: readonly string[] = ['/v1/scm/webhook/']

/**
 * Whether this request's body should be buffered at the edge before forwarding.
 *
 * Matched on the path only. A query string cannot opt a route in or out, and matching
 * the full URL would let `?x=/v1/scm/webhook/` change proxy behaviour.
 */
export function requiresBufferedBody(requestUrl: string, method: string): boolean {
  if (BODILESS_METHODS.has(method.toUpperCase())) return false
  const { pathname } = new URL(requestUrl)
  return BUFFERED_REQUEST_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

/**
 * Client-supplied forwarding/trust headers that must be stripped before we set
 * our own from the trusted Cloudflare edge. Forwarding an inbound value would
 * let a caller spoof their apparent IP for the API's rate-limit/audit/geo logic.
 */
const CLIENT_SPOOFABLE_HEADERS: ReadonlySet<string> = new Set([
  'x-forwarded-for',
  'x-real-ip',
  'forwarded',
])

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
export function buildProxyRequest(
  request: Request,
  apiOrigin: string,
  /**
   * Already-read body, for the paths in `BUFFERED_REQUEST_PATH_PREFIXES`. Passed in
   * rather than read here so this function stays synchronous and unit-testable, and so
   * the single `await` lives at the one call site that owns the decision.
   */
  bufferedBody?: ArrayBuffer,
): Request {
  const url = buildUpstreamUrl(request.url, apiOrigin)
  const headers = new Headers(request.headers)
  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header)
  headers.delete('host')

  // Drop any client-supplied forwarding/trust headers before setting our own.
  // The Worker sits directly behind Cloudflare, so `cf-connecting-ip` is the
  // single authoritative client IP; preserving an inbound X-Forwarded-For would
  // let a caller spoof their apparent IP for the API's rate-limit/audit/geo
  // decisions (the API trusts these headers via Fastify `trustProxy`).
  for (const header of CLIENT_SPOOFABLE_HEADERS) headers.delete(header)

  const clientIp = request.headers.get('cf-connecting-ip')
  if (clientIp) headers.set('x-forwarded-for', clientIp)
  headers.set('x-forwarded-proto', 'https')
  headers.set('x-forwarded-host', new URL(request.url).host)

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual',
  }
  if (bufferedBody !== undefined) {
    // No `duplex` here on purpose: the body is a complete ArrayBuffer, so there is
    // nothing half-duplex about it, and the origin receives a request with a known
    // Content-Length that is fully available the moment it is sent.
    init.body = bufferedBody
  } else if (!BODILESS_METHODS.has(request.method.toUpperCase())) {
    init.body = request.body
    init.duplex = 'half' // required when streaming a body (undici/Workers)
  }
  return new Request(url, init)
}

/**
 * Copy the upstream response back to the client, preserving status and every
 * `Set-Cookie` header individually (a naive `new Headers(res.headers)` collapses
 * multiple cookies into one comma-joined value and corrupts them).
 *
 * NOTE for anyone tempted to simplify this back to `new Headers(upstream.headers)`:
 * the unit suite will stay green if you do, because undici (Node) preserves the
 * set-cookie list through the Headers constructor. The Cloudflare Workers runtime this
 * actually runs on historically does not, and a corrupted `__Host-` session cookie is a
 * silent login failure. That difference is only observable under `wrangler pages dev`.
 */
export function buildClientResponse(upstream: Response): Response {
  const headers = new Headers()

  // Collected during the same pass, and used ONLY if `getSetCookie` turns out to be
  // unavailable. The previous version paired the skip below with `?? []`, so on a runtime
  // without `getSetCookie` every Set-Cookie header was skipped and then nothing was
  // appended — the cookies vanished. That is the worst shape this bug can take: the API
  // returns 200, the proxy returns 200, and the browser simply never receives the session
  // cookie, so a successful login presents as an immediate silent logout.
  const fallbackSetCookie: string[] = []

  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      fallbackSetCookie.push(value)
      return
    }
    headers.set(key, value)
  })

  const setCookies = upstream.headers.getSetCookie?.() ?? fallbackSetCookie
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
  // Read the body to completion first on the buffered paths. This is the whole point
  // of the buffering: the origin request must not begin until the body is in hand, or
  // the origin sits waiting on the network with the request already open — which is
  // exactly the latency this removes.
  const bufferedBody = requiresBufferedBody(request.url, request.method)
    ? await request.arrayBuffer()
    : undefined

  const upstream = await fetchImpl(buildProxyRequest(request, apiOrigin, bufferedBody))
  return buildClientResponse(upstream)
}
