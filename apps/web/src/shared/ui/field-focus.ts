/**
 * Shared focus treatment for EVERY form control — Input, Textarea, NativeSelect,
 * SearchableSelect, DateField, and RichTextEditor.
 *
 * Real-Rally style: a lighter accent-blue border (`--accent-border-active`) with
 * a soft 2px halo — deliberately NOT the heavy navy `--ring` + 3px ring. Defined
 * once here so all fields look identical when focused/active; change it in one
 * place and every control follows (the FE-consistency guarantee).
 *
 * Two variants because most controls focus via the native `:focus-visible`
 * pseudo-class, while the rich-text editor toggles a JS `focused` boolean from
 * TipTap's focus/blur events.
 */

/** For controls whose focus is the native `:focus-visible` pseudo-class. */
export const FIELD_FOCUS_VISIBLE =
  'focus-visible:border-accent-border-active focus-visible:ring-2 focus-visible:ring-accent-border-active/40'

/** Same look driven by a JS `focused` boolean (RichTextEditor). Pair with a `border` base + `border-input` at rest. */
export const FIELD_FOCUS_ACTIVE = 'border-accent-border-active ring-2 ring-accent-border-active/40'
