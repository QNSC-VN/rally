import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Settings ▸ API Tokens, as a reader sees it.
 *
 * Three properties carry the weight, and each closes a way this screen could mislead:
 *
 *  • a failed request must not render as "you have no tokens" — that sentence invites minting a
 *    second credential for something that already has one (`shared/lib/query/resource.ts`);
 *  • a revoked token stays listed, because `revokedAt` is the audit trail and a vanished row takes
 *    it with it;
 *  • nothing offers to show a token again, because nothing can.
 */

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { ApiTokensTab } from './api-tokens-tab'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>
const mockDELETE = apiClient.DELETE as ReturnType<typeof vi.fn>

const FAR_FUTURE = new Date(Date.now() + 200 * 86_400_000).toISOString()
const SOON = new Date(Date.now() + 3 * 86_400_000).toISOString()
const PAST = new Date(Date.now() - 86_400_000).toISOString()

function token(overrides: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    name: 'CI pipeline',
    prefix: 'rly_abc12345',
    scopes: null,
    expiresAt: FAR_FUTURE,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: PAST,
    userId: 'u-1',
    ...overrides,
  }
}

function renderTab() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <ApiTokensTab />
    </QueryClientProvider>,
  )
}

function listReturns(rows: unknown[]) {
  mockGET.mockResolvedValue({ data: rows, error: undefined, response: { status: 200 } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDELETE.mockResolvedValue({ data: undefined, error: undefined, response: { status: 204 } })
})

describe('the list', () => {
  it('shows a token with its prefix and expiry', async () => {
    listReturns([token()])
    renderTab()

    expect(await screen.findByText('CI pipeline')).toBeTruthy()
    // The prefix is what appears in a log line, so it is the row's second identity.
    expect(screen.getByText(/rly_abc12345/)).toBeTruthy()
    expect(screen.getByText(/Expires in \d+ days/)).toBeTruthy()
  })

  it('marks a token expiring inside the notice window', async () => {
    listReturns([token({ expiresAt: SOON })])
    renderTab()

    expect(await screen.findByText('Expiring')).toBeTruthy()
  })

  it('says plainly when a token has never been used', async () => {
    // The strongest signal that revoking it breaks nothing.
    listReturns([token()])
    renderTab()

    expect(await screen.findByText('Never used')).toBeTruthy()
  })

  it('keeps a revoked token listed', async () => {
    listReturns([token({ revokedAt: PAST })])
    renderTab()

    expect(await screen.findByText('CI pipeline')).toBeTruthy()
    expect(screen.getByText('Revoked')).toBeTruthy()
  })

  it('offers no revoke action on a token that is already done', async () => {
    listReturns([token({ revokedAt: PAST }), token({ id: 't-2', expiresAt: PAST })])
    renderTab()

    await screen.findByText('Revoked')
    expect(screen.queryByRole('button', { name: /^Revoke / })).toBeNull()
  })

  it('never offers to show a token again', async () => {
    // There is nothing to show: the value exists only in the mint response. An action implying
    // otherwise would be a promise the backend cannot keep.
    listReturns([token()])
    renderTab()

    await screen.findByText('CI pipeline')
    expect(screen.queryByRole('button', { name: /view|reveal|show/i })).toBeNull()
  })
})

describe('empty and failed are different answers', () => {
  it('invites a first token when the server says there are none', async () => {
    listReturns([])
    renderTab()

    expect(await screen.findByText('No API tokens')).toBeTruthy()
  })

  it('says the read failed rather than that there is nothing', async () => {
    mockGET.mockResolvedValue({
      data: undefined,
      error: { message: 'boom' },
      response: { status: 500 },
    })
    renderTab()

    expect(await screen.findByText('Could not load your tokens')).toBeTruthy()
    expect(screen.queryByText('No API tokens')).toBeNull()
  })
})

describe('revoking', () => {
  it('asks first, and says the change cannot be undone', async () => {
    listReturns([token()])
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke CI pipeline' }))

    expect(await screen.findByText(/cannot be undone/i)).toBeTruthy()
    expect(mockDELETE).not.toHaveBeenCalled()
  })

  it('revokes by id once confirmed', async () => {
    listReturns([token()])
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke CI pipeline' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke token' }))

    await waitFor(() => expect(mockDELETE).toHaveBeenCalledTimes(1))
    expect(mockDELETE).toHaveBeenCalledWith('/v1/me/api-tokens/{id}', {
      params: { path: { id: 't-1' } },
    })
  })

  it('does nothing when the confirmation is dismissed', async () => {
    listReturns([token()])
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke CI pipeline' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(mockDELETE).not.toHaveBeenCalled()
  })
})
