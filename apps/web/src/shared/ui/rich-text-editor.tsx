/**
 * RichTextEditor — contentEditable-based rich text component.
 *
 * Design principles:
 * - Matches the mockup toolbar exactly (Bold/Italic/Underline/Strike,
 *   lists, headings, links, code, undo/redo).
 * - Uses document.execCommand (universally supported in browsers for Phase 1).
 * - Saves via onBlur; calls onSave(html) only when content actually changed.
 * - Renders with DOMPurify-sanitized dangerouslySetInnerHTML (XSS-safe).
 * - readOnly prop disables all editing and shows a flat read view.
 * - Keyboard shortcut: Ctrl/Cmd+Enter saves immediately.
 */
import { useRef, useCallback, useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
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
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => {
        // Prevent blur before execCommand
        e.preventDefault()
        if (!disabled) onAction()
      }}
      className="flex h-7 w-7 items-center justify-center rounded-sm transition-colors"
      style={{
        color: active ? '#2558a6' : '#475569',
        backgroundColor: active ? '#edf2fb' : 'transparent',
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!disabled)
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = active
            ? '#dbeafe'
            : '#edf2f7'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = active
          ? '#edf2fb'
          : 'transparent'
      }}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0" style={{ backgroundColor: '#d7dde7' }} />
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
  const editorRef = useRef<HTMLDivElement>(null)
  const savedRef = useRef<string>('')
  const [expanded, setExpanded] = useState(false)
  const [focused, setFocused] = useState(false)

  // Sync external value into editor (only when it changes externally)
  useEffect(() => {
    if (!editorRef.current) return
    const clean = sanitize(value ?? '')
    // Only update DOM if different to avoid losing cursor position
    if (editorRef.current.innerHTML !== clean) {
      editorRef.current.innerHTML = clean
      savedRef.current = clean
    }
  }, [value])

  const exec = useCallback((command: string, value?: string) => {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
  }, [])

  const handleBlur = useCallback(() => {
    setFocused(false)
    if (!editorRef.current || readOnly || !onSave) return
    const html = sanitize(editorRef.current.innerHTML)
    if (html !== savedRef.current) {
      savedRef.current = html
      onSave(html)
    }
  }, [readOnly, onSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      editorRef.current?.blur()
    }
  }, [])

  const handleFormatBlock = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      exec('formatBlock', e.target.value)
      editorRef.current?.focus()
    },
    [exec],
  )

  const handleLink = useCallback(() => {
    const url = window.prompt('Enter URL:')
    if (url) exec('createLink', url)
  }, [exec])

  return (
    <section
      className={`overflow-hidden rounded bg-white transition-[border-color,box-shadow] ${className}`}
      style={{
        border: focused ? '1px solid var(--ring)' : '1px solid #dde2ea',
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
        className="flex items-center justify-between px-4 py-2 text-[11px] font-semibold select-none"
        style={{
          color: '#475569',
          backgroundColor: '#f8fafc',
          borderBottom: '1px solid #dde2ea',
          flexShrink: 0,
        }}
      >
        <span>{title}</span>
        {!readOnly && (
          <button
            type="button"
            aria-label={expanded ? 'Collapse editor' : 'Expand editor'}
            onClick={() => setExpanded((v) => !v)}
            className="rounded p-0.5 hover:bg-slate-200"
            style={{ color: '#64748b' }}
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        )}
      </div>

      {/* Toolbar */}
      {!readOnly && (
        <div
          className="flex flex-wrap items-center gap-0.5 overflow-x-auto px-2 py-1.5"
          style={{ borderBottom: '1px solid #dde2ea', backgroundColor: 'white', flexShrink: 0 }}
        >
          <ToolButton label="Undo" onAction={() => exec('undo')}>
            <Undo2 size={13} />
          </ToolButton>
          <ToolButton label="Redo" onAction={() => exec('redo')}>
            <Redo2 size={13} />
          </ToolButton>
          <Divider />
          <select
            aria-label="Text style"
            onChange={handleFormatBlock}
            defaultValue="p"
            className="h-7 w-28 rounded-sm bg-white px-2 text-[11px] focus:outline-none"
            style={{ color: '#334155', border: '1px solid #d7dde7' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <option value="p">Paragraph</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="blockquote">Quote</option>
          </select>
          <Divider />
          <ToolButton label="Bold" onAction={() => exec('bold')}>
            <Bold size={14} />
          </ToolButton>
          <ToolButton label="Italic" onAction={() => exec('italic')}>
            <Italic size={14} />
          </ToolButton>
          <ToolButton label="Underline" onAction={() => exec('underline')}>
            <Underline size={14} />
          </ToolButton>
          <ToolButton label="Strikethrough" onAction={() => exec('strikeThrough')}>
            <Strikethrough size={14} />
          </ToolButton>
          <Divider />
          <ToolButton label="Bulleted list" onAction={() => exec('insertUnorderedList')}>
            <List size={14} />
          </ToolButton>
          <ToolButton label="Numbered list" onAction={() => exec('insertOrderedList')}>
            <ListOrdered size={14} />
          </ToolButton>
          <ToolButton label="Align left" onAction={() => exec('justifyLeft')}>
            <AlignLeft size={14} />
          </ToolButton>
          <Divider />
          <ToolButton label="Insert link" onAction={handleLink}>
            <Link2 size={14} />
          </ToolButton>
          <ToolButton label="Inline code" onAction={() => exec('formatBlock', 'pre')}>
            <Code2 size={14} />
          </ToolButton>
        </div>
      )}

      {/* Content area */}
      {readOnly ? (
        <div
          className="prose prose-sm max-w-none px-4 py-3 text-[13px] leading-6"
          style={{
            minHeight,
            color: '#334155',
            backgroundColor: '#f8fafc',
            overflowY: expanded ? 'auto' : undefined,
            flex: expanded ? '1' : undefined,
          }}
          dangerouslySetInnerHTML={{ __html: sanitize(value ?? '') }}
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="prose prose-sm max-w-none px-4 py-3 text-[13px] leading-6 focus:outline-none"
          style={{
            minHeight,
            color: '#334155',
            backgroundColor: 'white',
            overflowY: expanded ? 'auto' : undefined,
            flex: expanded ? '1' : undefined,
          }}
          data-placeholder={`Add ${title.toLowerCase()}…`}
        />
      )}

      {/* Keyboard hint */}
      {!readOnly && (
        <div
          className="px-4 py-1 text-[10px] select-none"
          style={{
            color: '#94a3b8',
            borderTop: '1px solid #f1f5f9',
            flexShrink: 0,
          }}
        >
          Ctrl+Enter to save · changes auto-saved on blur
        </div>
      )}
    </section>
  )
}
