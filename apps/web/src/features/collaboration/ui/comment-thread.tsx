/**
 * CommentThread — F5 work-item comments UI for the Work Item Detail page.
 *
 * Lists comments (author, relative time, edited marker), lets any collaborator
 * post a comment, and edit/delete their own. Supports lightweight @mentions:
 * typing "@" opens a project-member picker; the selected members are sent as
 * mentionedUserIds so the backend fires mention notifications (F7).
 * Read-only mode (viewers) hides the composer and edit/delete controls.
 */
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Pencil, Trash2 } from 'lucide-react'
import {
  useComments,
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
  type Comment,
} from '@/features/collaboration/api'
import { useProjectMembers } from '@/features/teams/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useClickOutside } from '@/shared/lib/hooks/use-click-outside'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/icon-button'
import { Textarea } from '@/shared/ui/textarea'
import { cn } from '@/shared/lib/utils'

function relativeTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

interface CommentThreadProps {
  workItemId: string | undefined
  projectId: string | undefined
  readOnly?: boolean
}

export function CommentThread({ workItemId, projectId, readOnly = false }: CommentThreadProps) {
  const { data: comments = [], isLoading } = useComments(workItemId)
  const { data: members = [] } = useProjectMembers(projectId)
  const createMutation = useCreateComment(workItemId)
  const updateMutation = useUpdateComment(workItemId)
  const deleteMutation = useDeleteComment(workItemId)
  const currentUserId = useAuthStore((s) => s.user?.id)

  const [draft, setDraft] = useState('')
  const [mentioned, setMentioned] = useState<Record<string, string>>({}) // userId -> displayName
  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useClickOutside<HTMLDivElement>(showPicker, () => setShowPicker(false))
  const [activeIdx, setActiveIdx] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const mem of members) m.set(mem.userId, mem.displayName ?? mem.userId.slice(0, 8))
    return m
  }, [members])

  function onDraftChange(v: string) {
    setDraft(v)
    // Open the mention picker when the last token starts with '@'.
    const lastToken =
      v
        .slice(0, taRef.current?.selectionStart ?? v.length)
        .split(/\s/)
        .pop() ?? ''
    setShowPicker(lastToken.startsWith('@'))
    setActiveIdx(0)
  }

  function pickMention(userId: string, name: string) {
    // Replace the trailing '@partial' with '@Name '.
    setDraft((d) => d.replace(/@\S*$/, `@${name} `))
    setMentioned((m) => ({ ...m, [userId]: name }))
    setShowPicker(false)
    taRef.current?.focus()
  }

  async function post() {
    const body = draft.trim()
    if (!body) return
    // Only keep mentions whose @Name still appears in the body.
    const mentionedUserIds = Object.entries(mentioned)
      .filter(([, name]) => body.includes(`@${name}`))
      .map(([id]) => id)
    await createMutation.mutateAsync({ body, mentionedUserIds })
    setDraft('')
    setMentioned({})
  }

  async function saveEdit(id: string) {
    const body = editBody.trim()
    if (body) await updateMutation.mutateAsync({ commentId: id, body })
    setEditingId(null)
  }

  const memberMatches = useMemo(() => {
    const lastToken = draft.split(/\s/).pop() ?? ''
    const q = lastToken.replace(/^@/, '').toLowerCase()
    return members.filter((m) => (m.displayName ?? '').toLowerCase().includes(q)).slice(0, 6)
  }, [draft, members])

  // Keep the highlighted suggestion in range as the query narrows the list.
  useEffect(() => {
    setActiveIdx((i) => (i >= memberMatches.length ? 0 : i))
  }, [memberMatches.length])

  // Keyboard nav for the @mention picker: ↑/↓ move, Tab/Enter pick, Esc close.
  function onDraftKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!showPicker || memberMatches.length === 0) return
    const len = memberMatches.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => (i + 1) % len)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => (i - 1 + len) % len)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const m = memberMatches[activeIdx]
      if (m) {
        e.preventDefault()
        pickMention(m.userId, m.displayName ?? m.userId.slice(0, 8))
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setShowPicker(false)
    }
  }

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center gap-1.5 text-ui-md font-semibold text-muted-foreground">
        <MessageSquare size={13} />
        Comments
        {comments.length > 0 && <span className="text-foreground-subtle">({comments.length})</span>}
      </div>

      {isLoading ? (
        <p className="text-ui-md text-foreground-subtle">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-ui-md text-foreground-subtle">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {[...comments]
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((c: Comment) => {
              const author = nameById.get(c.authorId) ?? c.authorId.slice(0, 8)
              const mine = c.authorId === currentUserId
              return (
                <li key={c.id} className="flex gap-2">
                  <OwnerAvatar name={author} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-ui-sm text-foreground-subtle">
                      <span className="font-medium text-foreground">{author}</span>
                      <span>{relativeTime(c.createdAt)}</span>
                      {c.isEdited && <span className="italic">(edited)</span>}
                      {mine && !readOnly && editingId !== c.id && (
                        <span className="ml-auto flex gap-1">
                          <IconButton
                            size="sm"
                            aria-label="Edit comment"
                            title="Edit"
                            onClick={() => {
                              setEditingId(c.id)
                              setEditBody(c.body)
                            }}
                          >
                            <Pencil size={11} />
                          </IconButton>
                          <IconButton
                            size="sm"
                            variant="destructive"
                            aria-label="Delete comment"
                            title="Delete"
                            onClick={() => void deleteMutation.mutate(c.id)}
                          >
                            <Trash2 size={11} />
                          </IconButton>
                        </span>
                      )}
                    </div>
                    {editingId === c.id ? (
                      <div className="mt-1">
                        <Textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          rows={2}
                        />
                        <div className="mt-1 flex gap-2">
                          <Button size="sm" onClick={() => void saveEdit(c.id)}>
                            Save
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-0.5 text-ui-md whitespace-pre-wrap text-foreground">
                        {c.body}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
        </ul>
      )}

      {!readOnly && (
        <div ref={pickerRef} className="relative mt-3">
          <Textarea
            ref={taRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={onDraftKeyDown}
            placeholder="Add a comment… use @ to mention a teammate"
            rows={2}
          />
          {showPicker && memberMatches.length > 0 && (
            <ul className="absolute z-50 mt-0.5 max-h-44 w-64 overflow-y-auto rounded border border-input bg-card shadow-lg">
              {memberMatches.map((m, i) => (
                <li key={m.userId}>
                  <button
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => pickMention(m.userId, m.displayName ?? m.userId.slice(0, 8))}
                    className={cn(
                      'flex w-full items-center gap-2 px-2 py-1.5 text-left text-ui-md',
                      i === activeIdx ? 'bg-primary-lighter text-primary-light' : 'hover:bg-surface-hover',
                    )}
                  >
                    {m.displayName ?? m.userId.slice(0, 8)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 flex justify-end">
            <Button
              size="sm"
              onClick={() => void post()}
              disabled={!draft.trim() || createMutation.isPending}
            >
              Comment
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
