/**
 * The one definition of a minimum pointer target in this app.
 *
 * WCAG 2.5.8 Target Size (Minimum) is a level-AA success criterion: a target is at least 24×24 CSS px,
 * unless a 24px-diameter circle centred on it touches no other target's circle (the SPACING exception),
 * or it is inline in a sentence.
 *
 * `min-h-[24px]` is a PX LITERAL on purpose. `min-h-6` is `1.5rem`, and this app's root is 87.5% of the
 * reader's default font size — 14px for almost everyone — so the rem form resolves to 21px and quietly
 * sits under the floor it exists to hold. The criterion is stated in CSS px, so the class is too.
 *
 * `TARGET_SQUARE` is for an ICON-ONLY control, which has no text to widen it. `TARGET_HEIGHT` is for a
 * control with a label (its text supplies the width) and for the two in-grid gutter controls — the drag
 * grip and the expand chevron — which pass through the spacing exception rather than by growing: 34px
 * rows put their circles 34px apart vertically, and widening them would push every grid's left gutter
 * across by 6.5px to satisfy a criterion that is already met.
 *
 * Measured before this existed: `IconButton` computed to 15.5px (sm), 19px (md) and 22.5px (lg) tall,
 * `Button` `sm` to 22px and `xs` to 17.5px, the modal close button to 18.5px and the pagination arrows
 * to 23.5px. Every icon action in the product was under the minimum.
 */
export const TARGET_MIN_PX = 24

/** Icon-only controls — no label to widen them, so both axes need the floor. */
export const TARGET_SQUARE = 'min-h-[24px] min-w-[24px]'

/** Labelled controls, and gutter controls covered by the spacing exception. */
export const TARGET_HEIGHT = 'min-h-[24px]'
