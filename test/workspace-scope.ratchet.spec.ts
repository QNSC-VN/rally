/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Workspace-scope ratchet — the structural guard behind the app-layer isolation
 * model.
 *
 * There is no RLS: `workspace` isolation is enforced entirely by `workspace_id`
 * predicates that repository methods are trusted to carry (see the UnitOfWork
 * docblock and `docs/superpowers/specs/2026-07-09-drop-multi-tenant-merge-into-
 * workspace-design.md` §11). That trust is the whole security boundary, and
 * nothing currently stops the next repository method from quietly omitting it.
 *
 * This test counts repository methods that read or write a `workspace_id`-bearing
 * table without the caller's workspace anywhere in scope — neither a parameter
 * nor a value written in the body. The count may only ever DECREASE. A rise means
 * a new query relies on nothing but the calling service remembering to re-check
 * `row.workspaceId !== workspaceId`, which is the exact failure mode the boundary
 * cannot survive being wrong about even once.
 *
 * The baseline will never reach zero, and chasing that is not the goal. Several
 * classes are legitimately unscopable:
 *   • `identity.auth_sessions` / `sso_connections` — resolved BEFORE a workspace
 *     context exists; the session is what produces the workspace, not vice versa.
 *   • `workspace_invitations.findByTokenHash` and
 *     `api_tokens.findByPrefix` — the opaque credential IS the lookup key, and it is
 *     what PRODUCES the workspace; there is no workspace to filter by yet.
 *   • `workspace_members.findMembershipsForUser` / `workspace.listForUser` —
 *     cross-workspace by design; they back the workspace switcher.
 *   • `access.system_roles` rows with `workspace_id IS NULL` — global built-ins.
 * Everything else on the list is a load-then-check callsite that could carry its
 * own predicate instead. Lower the number by fixing those, never by raising it.
 *
 * __dirname, not import.meta.dirname: this project compiles as CommonJS, so the
 * meta-property fails `tsc --noEmit -p tsconfig.json` (TS1343). Same reason as
 * coverage-include.spec.ts.
 */

// ── Baseline — LOWER as methods take their own workspaceId, NEVER raise ──────
// RAISED 65→66, once, for `ApiTokenDrizzleRepository.findByPrefix` (migration 0125). Stated plainly
// because this comment forbids exactly what it is doing: the rule is right, and this is the enumerated
// exception above rather than a new load-then-check. Authentication resolves an opaque credential
// BEFORE any workspace exists — the token is what produces the workspace — so there is no predicate to
// add and no version of the method that lowers the count. It is the same class as
// `auth_sessions.findByTokenHash` and `workspace_invitations.findByTokenHash`, both already inside the
// baseline for the same reason.
// The other two methods that module adds are NOT here: `create` names `workspace_id` explicitly instead
// of spreading its input, and `touch` takes the workspace its caller has already read.
// Lowered 68→65, measured by forcing this to -1 and reading the count the failure reports. The three
// were pre-existing SLACK, not a win: the same measurement on the pristine tree also reports 65, so
// the dead-auth-code deletions did not move this number. `WorkspaceMemberDrizzleRepository.listMembers`
// went with the orphaned `WorkspaceMemberService` that was its only caller, but it filtered on
// `workspaceMembers.workspaceId` and so was never an offender — it only lowers METHODS_CONSIDERED
// (257→256), which is a floor with 56 points of headroom.
const MAX_UNSCOPED_METHODS = 66;

/** Sanity floors: if the parsers silently stop matching, this test must fail loudly. */
const MIN_SCOPED_TABLES = 40;
const MIN_METHODS_CONSIDERED = 200;

const ROOT = join(__dirname, '..');

function gitLsFiles(pattern: string): string[] {
  return execFileSync('git', ['ls-files', pattern], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/**
 * Drizzle table export names whose table declares a `workspace_id` column —
 * i.e. every table for which a query without a workspace predicate can cross the
 * isolation boundary. Junction tables and the global identity tables have no
 * such column and are deliberately not counted.
 */
function scopedTables(): Set<string> {
  const names = new Set<string>();
  for (const file of gitLsFiles('db/schema/*.ts')) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    // Split on the table declarations themselves so each chunk after a name is
    // that table's body — cheaper and less brittle than brace matching here,
    // because a table body always ends before the next `export const`.
    const parts = source.split(/export const (\w+) = \w+\.table\(/);
    for (let i = 1; i < parts.length; i += 2) {
      if (parts[i + 1].includes("uuid('workspace_id')")) names.add(parts[i]);
    }
  }
  return names;
}

interface Offender {
  file: string;
  method: string;
  tables: string[];
}

function unscopedMethods(): { offenders: Offender[]; considered: number } {
  const scoped = scopedTables();
  const offenders: Offender[] = [];
  let considered = 0;

  for (const file of gitLsFiles('libs/**/*.drizzle-repository.ts')) {
    const source = readFileSync(join(ROOT, file), 'utf8');

    // Class members are indented exactly two spaces; the trailing `[^{;]*\{`
    // skips interface/abstract declarations, which end in `;`.
    for (const match of source.matchAll(/\n {2}(?:async )?(\w+)\(([\s\S]*?)\)[^{;]*\{/g)) {
      const [, method, params] = match;
      const bodyStart = match.index + match[0].length;

      let depth = 1;
      let i = bodyStart;
      while (i < source.length && depth > 0) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') depth--;
        i++;
      }
      const body = source.slice(bodyStart, i);

      // Only the driver table matters: it owns the WHERE clause, so it is where
      // a missing predicate lets rows escape. Joined tables ride along on it.
      const tables = new Set<string>();
      for (const t of body.matchAll(/\.(?:from|insert|update|delete)\(\s*(\w+)/g)) tables.add(t[1]);
      const touched = [...tables].filter((t) => scoped.has(t));
      if (touched.length === 0) continue;

      considered++;
      // Params OR body: an insert that writes `input.workspaceId` is scoped even
      // though it takes no separate argument.
      if (!/workspaceId/.test(params + body)) {
        offenders.push({ file, method, tables: touched });
      }
    }
  }

  return { offenders, considered };
}

function report(offenders: Offender[]): string {
  const byFile = new Map<string, string[]>();
  for (const o of offenders) {
    byFile.set(o.file, [...(byFile.get(o.file) ?? []), `${o.method} [${o.tables.join(', ')}]`]);
  }
  return [...byFile.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([file, methods]) => `  ${file}\n${methods.map((m) => `      ${m}`).join('\n')}`)
    .join('\n');
}

describe('workspace-scope ratchet (only ever decreases)', () => {
  it('detects the schema and repository surface it claims to guard', () => {
    const scoped = scopedTables();
    const { considered } = unscopedMethods();

    // Without these, a broken regex turns the ratchet below into a test that
    // passes because it found nothing — the failure mode coverage-include.spec.ts
    // exists to prevent, applied to this parser.
    expect(
      scoped.size,
      'Found almost no workspace_id-bearing tables. The schema parser is broken, ' +
        'not the schema.',
    ).toBeGreaterThanOrEqual(MIN_SCOPED_TABLES);

    expect(
      considered,
      'Found almost no repository methods querying scoped tables. The method ' +
        'parser is broken, not the repositories.',
    ).toBeGreaterThanOrEqual(MIN_METHODS_CONSIDERED);
  });

  it(`repository methods querying a scoped table with no workspace in scope <= ${MAX_UNSCOPED_METHODS}`, () => {
    const { offenders } = unscopedMethods();

    if (offenders.length > MAX_UNSCOPED_METHODS) {
      throw new Error(
        `Unscoped repository methods rose to ${offenders.length} (baseline ${MAX_UNSCOPED_METHODS}).\n` +
          `A new query reads or writes a workspace_id-bearing table without the ` +
          `caller's workspace in scope. Take a workspaceId parameter and add the ` +
          `predicate — do not raise the baseline.\n\n${report(offenders)}`,
      );
    }

    expect(offenders.length).toBeLessThanOrEqual(MAX_UNSCOPED_METHODS);
  });
});
