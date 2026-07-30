import { describe, expect, it, vi } from 'vitest'
import {
  buildClientResponse,
  buildProxyRequest,
  buildUpstreamUrl,
  proxyToApi,
  requiresBufferedBody,
} from './proxy'

const API_ORIGIN = 'https://rally-api-dev.qnsc.vn'

describe('buildUpstreamUrl', () => {
  it('keeps the path and query while swapping the origin', () => {
    const result = buildUpstreamUrl(
      'https://rally-dev.qnsc.vn/v1/workspaces?limit=10&cursor=abc',
      API_ORIGIN,
    )
    expect(result).toBe('https://rally-api-dev.qnsc.vn/v1/workspaces?limit=10&cursor=abc')
  })

  it('handles the prefix root with no extra path or query', () => {
    const result = buildUpstreamUrl('https://rally-dev.qnsc.vn/bff/login', API_ORIGIN)
    expect(result).toBe('https://rally-api-dev.qnsc.vn/bff/login')
  })
})

describe('buildProxyRequest', () => {
  it('preserves method and target url', () => {
    const request = new Request('https://rally-dev.qnsc.vn/v1/me', { method: 'GET' })
    const proxied = buildProxyRequest(request, API_ORIGIN)
    expect(proxied.method).toBe('GET')
    expect(proxied.url).toBe('https://rally-api-dev.qnsc.vn/v1/me')
  })

  it('strips the host header and sets forwarding headers from the edge', () => {
    const request = new Request('https://rally-dev.qnsc.vn/v1/me', {
      method: 'GET',
      headers: {
        host: 'rally-dev.qnsc.vn',
        'cf-connecting-ip': '203.0.113.7',
        cookie: '__Host-rally_session=abc',
      },
    })
    const proxied = buildProxyRequest(request, API_ORIGIN)
    expect(proxied.headers.get('host')).toBeNull()
    expect(proxied.headers.get('x-forwarded-for')).toBe('203.0.113.7')
    expect(proxied.headers.get('x-forwarded-proto')).toBe('https')
    expect(proxied.headers.get('x-forwarded-host')).toBe('rally-dev.qnsc.vn')
    // App headers must survive the hop.
    expect(proxied.headers.get('cookie')).toBe('__Host-rally_session=abc')
  })

  it('forwards the CSRF token header', () => {
    // The API rejects a cookie-authenticated write whose X-CSRF-Token is missing,
    // so a future change to the header filter must not drop this one silently.
    const request = new Request('https://rally-dev.qnsc.vn/v1/work-items', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': '203.0.113.7',
        cookie: '__Host-rally_session=abc; __Host-rally_csrf=secret',
        'x-csrf-token': 'tok-1',
        'content-type': 'application/json',
      },
      body: '{}',
    })
    const proxied = buildProxyRequest(request, API_ORIGIN)
    expect(proxied.headers.get('x-csrf-token')).toBe('tok-1')
    expect(proxied.headers.get('cookie')).toBe('__Host-rally_session=abc; __Host-rally_csrf=secret')
  })

  it('drops a client-supplied x-forwarded-for and trusts only cf-connecting-ip', () => {
    const request = new Request('https://rally-dev.qnsc.vn/v1/me', {
      headers: {
        'x-forwarded-for': '198.51.100.1',
        'x-real-ip': '198.51.100.1',
        forwarded: 'for=198.51.100.1',
        'cf-connecting-ip': '203.0.113.7',
      },
    })
    const proxied = buildProxyRequest(request, API_ORIGIN)
    expect(proxied.headers.get('x-forwarded-for')).toBe('203.0.113.7')
    expect(proxied.headers.get('x-real-ip')).toBeNull()
    expect(proxied.headers.get('forwarded')).toBeNull()
  })

  it('drops hop-by-hop headers', () => {
    const request = new Request('https://rally-dev.qnsc.vn/v1/me', {
      headers: { connection: 'keep-alive', 'keep-alive': 'timeout=5' },
    })
    const proxied = buildProxyRequest(request, API_ORIGIN)
    expect(proxied.headers.get('connection')).toBeNull()
    expect(proxied.headers.get('keep-alive')).toBeNull()
  })

  it('forwards a body for non-GET/HEAD methods', () => {
    const request = new Request('https://rally-dev.qnsc.vn/v1/things', {
      method: 'POST',
      body: JSON.stringify({ name: 'x' }),
      headers: { 'content-type': 'application/json' },
    })
    const proxied = buildProxyRequest(request, API_ORIGIN)
    expect(proxied.method).toBe('POST')
    expect(proxied.body).not.toBeNull()
  })
})

describe('buildClientResponse', () => {
  it('preserves status and passes through headers', () => {
    const upstream = new Response('ok', {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'text/plain' },
    })
    const result = buildClientResponse(upstream)
    expect(result.status).toBe(201)
    expect(result.headers.get('content-type')).toBe('text/plain')
  })

  // LIMIT OF THE TEST BELOW, stated because it is easy to over-read: it pins the
  // CONTRACT (two cookies in, two out, values intact) and would catch cookies being
  // dropped, but it does NOT distinguish the per-cookie loop from a naive
  // `new Headers(upstream.headers)` — undici preserves the set-cookie list through the
  // constructor, so that swap keeps this suite green. See the note on
  // buildClientResponse; verifying it needs the Workers runtime, not vitest.
  it('preserves multiple Set-Cookie headers individually', () => {
    const upstream = new Response(null, { status: 204 })
    upstream.headers.append('set-cookie', '__Host-rally_session=abc; Path=/; Secure')
    upstream.headers.append('set-cookie', '__Host-bff_state=; Path=/; Max-Age=0')
    const result = buildClientResponse(upstream)
    const cookies = result.headers.getSetCookie?.() ?? []
    expect(cookies).toHaveLength(2)
    expect(cookies).toContain('__Host-rally_session=abc; Path=/; Secure')
    expect(cookies).toContain('__Host-bff_state=; Path=/; Max-Age=0')
  })

  // The fallback path, and the reason it exists. `getSetCookie` is skipped over in the
  // header loop, so pairing that skip with `?? []` meant a runtime WITHOUT it dropped
  // every cookie: 200 from the API, 200 from the proxy, and no session cookie at the
  // browser — a successful login that presents as an immediate silent logout. Cookies
  // must survive even when the capability does not.
  it('still forwards Set-Cookie when the runtime has no getSetCookie', () => {
    const upstream = new Response(null, {
      status: 204,
      headers: { 'set-cookie': '__Host-rally_session=abc; Path=/; Secure' },
    })
    Object.defineProperty(upstream.headers, 'getSetCookie', { value: undefined })

    const result = buildClientResponse(upstream)

    expect(result.headers.get('set-cookie')).toBe('__Host-rally_session=abc; Path=/; Secure')
  })

  it('does not leak the fallback into the normal path', () => {
    // With getSetCookie present the per-cookie list wins, so a cookie is appended once
    // rather than twice — a double-append would corrupt the header.
    const upstream = new Response(null, { status: 204 })
    upstream.headers.append('set-cookie', 'a=1; Path=/')

    const result = buildClientResponse(upstream)

    expect(result.headers.getSetCookie?.() ?? []).toEqual(['a=1; Path=/'])
  })
})

describe('proxyToApi', () => {
  it('returns 500 when the API origin is not configured', async () => {
    const request = new Request('https://rally-dev.qnsc.vn/v1/me')
    const response = await proxyToApi(request, undefined, vi.fn())
    expect(response.status).toBe(500)
  })

  it('forwards the request to the API origin and returns its response', async () => {
    const request = new Request('https://rally-dev.qnsc.vn/v1/me', {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    })
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const response = await proxyToApi(request, API_ORIGIN, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const forwarded = fetchImpl.mock.calls[0][0] as Request
    expect(forwarded.url).toBe('https://rally-api-dev.qnsc.vn/v1/me')
    expect(forwarded.headers.get('x-forwarded-for')).toBe('203.0.113.7')
    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('{"ok":true}')
  })
})

describe('requiresBufferedBody', () => {
  it('buffers the SCM webhook path, which is the one measured to need it', () => {
    expect(requiresBufferedBody('https://rally.qnsc.vn/v1/scm/webhook/github', 'POST')).toBe(true)
    expect(requiresBufferedBody('https://rally.qnsc.vn/v1/scm/webhook/ghe', 'POST')).toBe(true)
  })

  it('leaves every other path streaming', () => {
    // Blanket buffering would pull the 10 MB multipart uploads into edge memory to fix
    // a problem only small JSON webhooks have.
    expect(requiresBufferedBody('https://rally.qnsc.vn/v1/auth/me/avatar/confirm', 'POST')).toBe(
      false,
    )
    expect(requiresBufferedBody('https://rally.qnsc.vn/v1/work-items', 'POST')).toBe(false)
    expect(requiresBufferedBody('https://rally.qnsc.vn/v1/bff/me', 'POST')).toBe(false)
  })

  it('never buffers a bodiless method', () => {
    expect(requiresBufferedBody('https://rally.qnsc.vn/v1/scm/webhook/github', 'GET')).toBe(false)
    expect(requiresBufferedBody('https://rally.qnsc.vn/v1/scm/webhook/github', 'HEAD')).toBe(false)
    // Case-insensitive, since the method arrives as-sent.
    expect(requiresBufferedBody('https://rally.qnsc.vn/v1/scm/webhook/github', 'get')).toBe(false)
  })

  it('matches on the path, so a query string cannot opt a route in', () => {
    // Matching the whole URL would let `?x=/v1/scm/webhook/` change proxy behaviour.
    expect(
      requiresBufferedBody('https://rally.qnsc.vn/v1/work-items?x=/v1/scm/webhook/', 'POST'),
    ).toBe(false)
    // ...or out.
    expect(
      requiresBufferedBody('https://rally.qnsc.vn/v1/scm/webhook/github?foo=bar', 'POST'),
    ).toBe(true)
  })
})

describe('proxyToApi body buffering', () => {
  it('sends the webhook body as a complete buffer, byte-identical to the original', async () => {
    // Byte fidelity is not cosmetic here: the receiver verifies an HMAC over the RAW
    // body, so a single altered byte turns every delivery into a 401.
    const payload = JSON.stringify({ zen: 'x'.repeat(2048) })
    const fetchImpl = vi.fn(async (req: Request) => {
      expect(req.body).not.toBe(null)
      const forwarded = await req.text()
      expect(forwarded).toBe(payload)
      return new Response('{}', { status: 202 })
    })

    const res = await proxyToApi(
      new Request('https://rally.qnsc.vn/v1/scm/webhook/github', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-github-event': 'push' },
        body: payload,
      }),
      'https://rally-api.qnsc.vn',
      fetchImpl as unknown as typeof fetch,
    )

    expect(res.status).toBe(202)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('preserves the signature header the origin verifies against', async () => {
    const fetchImpl = vi.fn(async (req: Request) => {
      expect(req.headers.get('x-hub-signature-256')).toBe('sha256=abc')
      expect(req.headers.get('x-github-delivery')).toBe('d-1')
      return new Response('{}', { status: 202 })
    })

    await proxyToApi(
      new Request('https://rally.qnsc.vn/v1/scm/webhook/github', {
        method: 'POST',
        headers: { 'x-hub-signature-256': 'sha256=abc', 'x-github-delivery': 'd-1' },
        body: '{}',
      }),
      'https://rally-api.qnsc.vn',
      fetchImpl as unknown as typeof fetch,
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
