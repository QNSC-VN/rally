import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { TeamCell } from './team-cell'

/**
 * The chip's LABEL comes from the team key when there is one and from the name's initials when there is
 * not — which means the same team draws two different glyphs if one caller passes the key and another
 * does not. That is exactly what happened on the Portfolio grid: a parent row rendered `GA` (from key
 * `GAMMA`) while its own preview rows rendered `TG` (initials of `Team Gamma`), two rows apart.
 *
 * Pinned here because the fix lives at the CALL SITES — anything rendering this cell has to resolve the
 * key — and this test is what says why.
 */
describe('TeamCell', () => {
  it('labels the chip from the team KEY when one is given', () => {
    render(<TeamCell teamKey="GAMMA" name="Team Gamma" />)
    expect(screen.getByText('GA')).toBeInTheDocument()
    expect(screen.getByText('Team Gamma')).toBeInTheDocument()
  })

  it('falls back to the name’s initials — a DIFFERENT label for the same team', () => {
    render(<TeamCell name="Team Gamma" />)
    expect(screen.getByText('TG')).toBeInTheDocument()
    expect(screen.queryByText('GA')).toBeNull()
  })

  it('renders the shared placeholder when there is no team at all', () => {
    render(<TeamCell name={null} />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })
})
