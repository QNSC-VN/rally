import { describe, expect, it, vi } from 'vitest'
import { buildClientResponse, buildProxyRequest, buildUpstreamUrl, proxyToApi } from './proxy'

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
