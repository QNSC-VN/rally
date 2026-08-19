import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Minting is the only moment an API token exists in readable form: the database stores a SHA-256
 * hash, so no endpoint can return it again. Everything asserted here follows from that.
 *
 * The request body is pinned because it is the contract — the backend caps the lifetime at 365 days
 * and requires a name, and a form that sends something else spends a round trip discovering it.
 */

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { CreateTokenModal } from './create-token-modal'

const mockPOST = apiClient.POST as ReturnType<typeof vi.fn>

const CREATED = {
  id: 't-1',
  name: 'CI pipeline',
  prefix: 'rly_abc12345',
  scopes: null,
  expiresAt: '2026-12-01T12:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-06-01T12:00:00.000Z',
  userId: 'u-1',
  token: 'rly_abc12345_the_only_time_this_is_readable',
}

function renderModal(onClose = vi.fn()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <CreateTokenModal open onClose={onClose} />
    </QueryClientProvider>,
  )
  return onClose
}

function typeName(name = 'CI pipeline') {
  fireEvent.change(screen.getByPlaceholderText('CI pipeline'), { target: { value: name } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPOST.mockResolvedValue({ data: CREATED, error: undefined, response: { status: 201 } })
})

describe('the form', () => {
  it('refuses to send without a name', async () => {
    renderModal()
    submit()

    expect(await screen.findByText('Give the token a name')).toBeTruthy()
    expect(mockPOST).not.toHaveBeenCalled()
  })

  it('refuses a name that is only whitespace', () => {
    // The name is how a human recognises which token to revoke. `"   "` is not a name, and the API
    // would take it.
    renderModal()
    fireEvent.change(screen.getByPlaceholderText('CI pipeline'), { target: { value: '   ' } })
    submit()

    expect(mockPOST).not.toHaveBeenCalled()
  })

  it('sends the trimmed name and the chosen lifetime', async () => {
    renderModal()
    fireEvent.change(screen.getByPlaceholderText('CI pipeline'), {
      target: { value: '  CI pipeline  ' },
    })
    fireEvent.change(screen.getByLabelText('Expires after'), { target: { value: '30' } })
    submit()

    await waitFor(() => expect(mockPOST).toHaveBeenCalledTimes(1))
    expect(mockPOST).toHaveBeenCalledWith('/v1/me/api-tokens', {
      body: { name: 'CI pipeline', expiresInDays: 30 },
    })
  })

  it('defaults to the lifetime the backend defaults to', async () => {
    renderModal()
    typeName()
    submit()

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    expect(mockPOST.mock.calls[0][1].body.expiresInDays).toBe(90)
  })

  it('offers no lifetime the API would refuse', () => {
    renderModal()
    const options = [...screen.getByLabelText('Expires after').querySelectorAll('option')]

    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      expect(Number(option.getAttribute('value'))).toBeLessThanOrEqual(365)
      expect(Number(option.getAttribute('value'))).toBeGreaterThan(0)
    }
  })
})

describe('the credential, shown once', () => {
  it('shows the token and says it will not be shown again', async () => {
    renderModal()
    typeName()
    submit()

    expect(await screen.findByText(CREATED.token)).toBeTruthy()
    expect(screen.getByText(/one and only time it can be shown/i)).toBeTruthy()
  })

  it('does not close on its own after minting', async () => {
    // The panel is not optional: a mint that closes without showing its token has produced a
    // credential nobody has, and it cannot be asked for again.
    const onClose = renderModal()
    typeName()
    submit()

    await screen.findByText(CREATED.token)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes only on the explicit acknowledgement, and drops the credential', async () => {
    const onClose = renderModal()
    typeName()
    submit()

    fireEvent.click(await screen.findByRole('button', { name: 'I have stored it' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    // Gone from the DOM as well as from state: the next open must start at the form, never at a
    // stale credential from a previous mint.
    expect(screen.queryByText(CREATED.token)).toBeNull()
  })

  it('offers a copy action rather than expecting a hand transcription', async () => {
    renderModal()
    typeName()
    submit()

    expect(await screen.findByRole('button', { name: 'Copy token' })).toBeTruthy()
  })

  it('keeps the form open when the mint fails', async () => {
    mockPOST.mockResolvedValue({
      data: undefined,
      error: { message: 'quota exceeded' },
      response: { status: 429 },
    })
    renderModal()
    typeName()
    submit()

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    // Still the form, so the name is not retyped — and no panel implying a token exists.
    expect(screen.getByPlaceholderText('CI pipeline')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'I have stored it' })).toBeNull()
  })
})
