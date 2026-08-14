/**
 * Comments and Linked Items — a failed read must not invite the reader to start over.
 *
 * Both panels sit on the Work Item detail page and both had the same shape: `data ?? []`, so a 403
 * or a 500 rendered "No comments yet." / "No linked items." — a statement about the record, from a
 * request that never landed. The comment case is the one with a behavioural consequence: a reader
 * who is told a discussion does not exist re-opens it, and the original thread is still there.
 *
 * These are NEGATIVE assertions on purpose — the fabricated sentence must be ABSENT, not merely
 * accompanied by an error message. Team Capacity shipped the accompanied version (four `0h` cards
 * directly above their own error) and it read as data.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const commentFeed: { data?: unknown[]; isLoading?: boolean; isError?: boolean; error?: unknown } = {
  data: [],
}
const relationFeed: { data?: unknown[]; isLoading?: boolean; isError?: boolean; error?: unknown } =
  {
    data: [],
  }

vi.mock('@/features/collaboration/api', () => ({
  useComments: () => commentFeed,
  useCreateComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/features/teams/api', () => ({ useProjectMemberOptions: () => ({ data: [] }) }))

vi.mock('@/features/work-items/api', () => ({
  useRelations: () => relationFeed,
  useLinkWorkItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnlinkWorkItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/shared/lib/stores/auth.store', () => ({
  useAuthStore: () => ({ id: 'u-1', displayName: 'Marcus Webb' }),
}))

import { CommentThread } from './comment-thread'
import { LinkedItemsBlock } from '@/features/work-items/ui/linked-items-block'

beforeEach(() => {
  for (const feed of [commentFeed, relationFeed]) {
    feed.data = []
    feed.isLoading = false
    feed.isError = false
    feed.error = undefined
  }
})

describe('CommentThread', () => {
  it('renders an ERROR and NOT "No comments yet." when the read failed', () => {
    commentFeed.data = undefined
    commentFeed.isError = true
    commentFeed.error = new Error('403 forbidden')
    render(<CommentThread subject={{ entityType: 'work_item', entityId: 'w-1' }} projectId="p-1" />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('No comments yet.')).not.toBeInTheDocument()
  })

  it('renders "No comments yet." when the server really answered with none', () => {
    render(<CommentThread subject={{ entityType: 'work_item', entityId: 'w-1' }} projectId="p-1" />)

    expect(screen.getByText('No comments yet.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('LinkedItemsBlock', () => {
  it('renders an ERROR and NOT "No linked items." when the read failed', () => {
    relationFeed.data = undefined
    relationFeed.isError = true
    relationFeed.error = new Error('500')
    render(<LinkedItemsBlock workItemId="w-1" projectId="p-1" />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('No linked items.')).not.toBeInTheDocument()
  })

  it('renders "No linked items." when the server really answered with none', () => {
    render(<LinkedItemsBlock workItemId="w-1" projectId="p-1" />)

    expect(screen.getByText('No linked items.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
