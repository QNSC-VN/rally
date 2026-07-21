/**
 * RichTextEditor — Tiptap-based rich text component.
 *
 * Design principles:
 * - Matches the mockup toolbar exactly (Bold/Italic/Underline/Strike,
 *   lists, headings, links, code, undo/redo).
 * - Built on Tiptap/ProseMirror — `document.execCommand`, which this
 *   component used previously, has been dropped by Chrome/Edge for most
 *   rich-editing commands, silently no-op'ing every toolbar action and
 *   typed input. Tiptap owns the DOM directly via ProseMirror's own
 *   transaction model, so it isn't affected by that removal.
 * - Saves via onBlur; calls onSave(html) only when content actually changed.
 * - Output is DOMPurify-sanitized before both render and onSave, so a future
 *   extension misconfiguration still can't emit disallowed markup.
 * - readOnly prop disables all editing and shows a flat read view.
 * - Keyboard shortcut: Ctrl/Cmd+Enter saves immediately.
 */
import { BRAND } from '@/shared/config/brand'
import { useCallback, useEffect, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import DOMPurify from 'dompurify'
import { Tooltip } from './tooltip'
import {
  AlignLeft,
  Bold,
  Code2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react'

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'del',
      'strike',
      'h2',
      'h3',
      'h4',
      'blockquote',
      'pre',
      'code',
      'ul',
      'ol',
      'li',
      'a',
      'span',
      'div',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'hr',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
    ALLOW_DATA_ATTR: false,
  }) as string
}

// ── Toolbar button ────────────────────────────────────────────────────────────
interface ToolButtonProps {
  label: string
  disabled?: boolean
  active?: boolean
  onAction: () => void
  children: React.ReactNode
}

function ToolButton({ label, disabled, active, onAction, children }: ToolButtonProps) {
  return (
    <Tooltip content={label} delayDuration={800}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onMouseDown={(e) => {
          // Prevent editor blur before the command runs
          e.preventDefault()
          if (!disabled) onAction()
        }}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm transition-colors disabled:cursor-not-allowed"
        style={{
          color: active ? BRAND.primaryLight : BRAND.textSecondary,
          backgroundColor: active ? BRAND.primaryLighter : 'transparent',
          opacity: disabled ? 0.35 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        onMouseEnter={(e) => {
          if (!disabled)
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = active
              ? BRAND.primaryLighter
              : BRAND.pageBg
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = active
            ? BRAND.primaryLighter
            : 'transparent'
        }}
      >
        {children}
      </button>
    </Tooltip>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-input" />
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
function Toolbar({ editor }: { editor: Editor }) {
  const handleLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link')['href'] as string | undefined
    const url = window.prompt('Enter URL:', previousUrl ?? '')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  const formatValue = editor.isActive('heading', { level: 2 })
    ? 'h2'
    : editor.isActive('heading', { level: 3 })
      ? 'h3'
      : editor.isActive('blockquote')
        ? 'blockquote'
        : 'p'

  const handleFormatBlock = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const chain = editor.chain().focus()
      switch (e.target.value) {
        case 'h2':
          chain.setHeading({ level: 2 }).run()
          break
        case 'h3':
          chain.setHeading({ level: 3 }).run()
          break
        case 'blockquote':
          chain.setBlockquote().run()
          break
        default:
          chain.setParagraph().run()
      }
    },
    [editor],
  )

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 overflow-x-auto border-b border-border-strong bg-card px-2 py-1.5"
      style={{ flexShrink: 0 }}
    >
      <ToolButton
        label="Undo"
        disabled={!editor.can().undo()}
        onAction={() => editor.chain().focus().undo().run()}
      >
        <Undo2 size={13} />
      </ToolButton>
      <ToolButton
        label="Redo"
        disabled={!editor.can().redo()}
        onAction={() => editor.chain().focus().redo().run()}
      >
        <Redo2 size={13} />
      </ToolButton>
      <Divider />
      <select
        aria-label="Text style"
        value={formatValue}
        onChange={handleFormatBlock}
        className="h-7 w-28 rounded-sm border border-input bg-card px-2 text-ui-sm text-foreground focus:outline-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <option value="p">Paragraph</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="blockquote">Quote</option>
      </select>
      <Divider />
      <ToolButton
        label="Bold"
        active={editor.isActive('bold')}
        onAction={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={14} />
      </ToolButton>
      <ToolButton
        label="Italic"
        active={editor.isActive('italic')}
        onAction={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={14} />
      </ToolButton>
      <ToolButton
        label="Underline"
        active={editor.isActive('underline')}
        onAction={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline size={14} />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        active={editor.isActive('strike')}
        onAction={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={14} />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Bulleted list"
        active={editor.isActive('bulletList')}
        onAction={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={14} />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={editor.isActive('orderedList')}
        onAction={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={14} />
      </ToolButton>
      <ToolButton label="Align left" onAction={() => {}} disabled>
        <AlignLeft size={14} />
      </ToolButton>
      <Divider />
      <ToolButton label="Insert link" active={editor.isActive('link')} onAction={handleLink}>
        <Link2 size={14} />
      </ToolButton>
      <ToolButton
        label="Code block"
        active={editor.isActive('codeBlock')}
        onAction={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 size={14} />
      </ToolButton>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface RichTextEditorProps {
  /** Section heading shown in the header bar */
  title: string
  /** Initial HTML value (sanitized before rendering) */
  value?: string | null
  /** Minimum content area height in px */
  minHeight?: number
  /** Disable all editing */
  readOnly?: boolean
  /** Called with sanitized HTML when content is saved (blur or Ctrl+Enter) */
  onSave?: (html: string) => void
  /** Optional extra CSS class on the outer wrapper */
  className?: string
}

export function RichTextEditor({
  title,
  value,
  minHeight = 80,
  readOnly = false,
  onSave,
  className = '',
}: RichTextEditorProps) {
  const [expanded, setExpanded] = useState(false)
  const [focused, setFocused] = useState(false)

  const editor = useEditor({
    editable: !readOnly,
    immediatelyRender: false,
    extensions: [StarterKit, Placeholder.configure({ placeholder: `Add ${title.toLowerCase()}…` })],
    content: sanitize(value ?? ''),
    editorProps: {
      attributes: {
        class: 'px-4 py-3 text-ui-lg leading-6 text-foreground focus:outline-none',
      },
    },
    onFocus: () => setFocused(true),
    onBlur: ({ editor: ed }) => {
      setFocused(false)
      if (readOnly || !onSave) return
      const html = sanitize(ed.getHTML())
      if (html !== sanitize(value ?? '')) onSave(html)
    },
  })

  // Sync external value into the editor (only when it changes externally —
  // e.g. after a save round-trips, or another tab/user updates it). Comparing
  // sanitized HTML avoids clobbering the user's cursor on every keystroke.
  useEffect(() => {
    if (!editor) return
    const clean = sanitize(value ?? '')
    if (sanitize(editor.getHTML()) !== clean) {
      editor.commands.setContent(clean, { emitUpdate: false })
    }
  }, [value, editor])

  // Keep editable state in sync if readOnly changes after mount.
  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  const handleKeyDownCapture = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      ;(e.currentTarget.querySelector('.ProseMirror') as HTMLElement | null)?.blur()
    }
  }, [])

  if (!editor) return null

  return (
    <section
      className={`overflow-hidden rounded bg-card transition-[border-color,box-shadow] ${className}`}
      style={{
        border: focused ? '1px solid var(--ring)' : `1px solid ${BRAND.border}`,
        boxShadow: focused ? '0 0 0 3px color-mix(in srgb, var(--ring) 50%, transparent)' : 'none',
        ...(expanded
          ? {
              position: 'fixed',
              inset: '10%',
              zIndex: 50,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,.25)',
            }
          : {}),
      }}
    >
      {/* Section header */}
      <div
        className="flex items-center justify-between border-b border-border-strong bg-surface-hover px-4 py-2 text-ui-sm font-semibold text-muted-foreground select-none"
        style={{ flexShrink: 0 }}
      >
        <span>{title}</span>
        {!readOnly && (
          <button
            type="button"
            aria-label={expanded ? 'Collapse editor' : 'Expand editor'}
            onClick={() => setExpanded((v) => !v)}
            className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-slate-200"
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        )}
      </div>

      {/* Toolbar */}
      {!readOnly && <Toolbar editor={editor} />}

      {/* Content area */}
      <div
        onKeyDownCapture={handleKeyDownCapture}
        className={readOnly ? 'bg-surface-hover' : 'bg-card'}
        style={{
          minHeight,
          overflowY: expanded ? 'auto' : undefined,
          flex: expanded ? '1' : undefined,
        }}
      >
        <EditorContent editor={editor} />
      </div>

      {/* Keyboard hint */}
      {!readOnly && (
        <div
          className="border-t border-primary-lighter px-4 py-1 text-ui-xs text-foreground-subtle select-none"
          style={{ flexShrink: 0 }}
        >
          Ctrl+Enter to save · changes auto-saved on blur
        </div>
      )}
    </section>
  )
}
