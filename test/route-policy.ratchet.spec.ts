/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Route-policy ratchet — every HTTP route must declare who may call it.
 *
 * `PolicyGuard` is the single authorization decision point (its own docblock
 * says it "replaces PermissionGuard + ProjectPermissionGuard + service-level
 * assertProjectPermission"), and services below it now generally re-check only
 * the workspace. That design has one sharp edge, at policy.guard.ts:81:
 *
 *     if (!meta) return true;
 *
 * A handler with no `@RequirePermission` is not denied — it is ALLOWED, to any
 * authenticated caller. `@AuthPolicy()` on the controller does not help: it only
 * wires `UseGuards(JwtAuthGuard, PolicyGuard)` and sets no policy metadata. So a
 * forgotten decorator is not a broken route that someone will notice; it is a
 * silently open one. With a single workspace in practice, "open to any
 * authenticated caller" means open to every colleague in the company, including
 * for projects they hold no grant on.
 *
 * This counts route handlers carrying neither `@RequirePermission` nor
 * `@Public`. The count may only ever DECREASE.
 *
 * It will not reach zero, and should not: a real subset is self-scoped by
 * construction and has no permission to check —
 *   • `/v1/bff/*` and `auth/*` — they run before or around a session existing;
 *   • `notifications/*`, `me/*`, `notification-preferences/*` — addressed by
 *     `user.sub`, so the caller can only ever reach their own rows;
 *   • `scm/webhook/:provider` — authenticated by provider signature, not a user.
 * The rest are ordinary reads and writes that resolve a project or workspace
 * resource from the request and currently check nothing beyond authentication.
 * Those are the ones to work off. Lower the number by decorating them.
 *
 * __dirname, not import.meta.dirname: CommonJS (see coverage-include.spec.ts).
 */

// ── Baseline — LOWER as routes get decorated, NEVER raise ────────────────────
const MAX_UNPOLICED_ROUTES = 54;

/** Sanity floor: if the scanner stops finding routes, fail loudly, not silently. */
const MIN_ROUTES_FOUND = 150;

const ROOT = join(__dirname, '..');
const HTTP_METHOD = /^\s*@(Get|Post|Patch|Put|Delete)\(/;
const DECORATOR = /^\s*@\w+\(/;
const HANDLER = /^\s*(?:async\s+)?[\w[\]'"]+\s*\(/;
/**
 * Anchored to the start of the line (modulo indent) so it matches a real
 * decorator and not prose. An unanchored /@RequirePermission/ also matched the
 * comment above `export class ProjectsController` that mentions the decorator by
 * name, which silently excluded that entire controller — nine unpoliced routes,
 * including `GET /projects/:id` and `GET /projects/:id/activity`, reported clean.
 */
const POLICY = /^\s*@(RequirePermission|Public)\b/;
const COMMENT = /^\s*(\/\/|\/?\*)/;

interface Route {
  file: string;
  line: number;
  signature: string;
}

function scanRoutes(): { all: Route[]; unpoliced: Route[] } {
  const files = execFileSync(
    'git',
    ['ls-files', 'libs/**/*.controller.ts', 'apps/**/*.controller.ts'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);

  const all: Route[] = [];
  const unpoliced: Route[] = [];

  for (const file of files) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');

    // A class-level @RequirePermission would cover every handler in the file
    // (Reflector.getAllAndOverride reads handler THEN class). None exist today;
    // if one is ever added, honour it rather than reporting false positives.
    const classDeclaration = lines.findIndex((l) => /^export class/.test(l));
    const classPolicied =
      classDeclaration > 0 &&
      lines.slice(0, classDeclaration).some((l) => !COMMENT.test(l) && POLICY.test(l));

    for (let i = 0; i < lines.length; i++) {
      if (!HTTP_METHOD.test(lines[i])) continue;

      // Everything between the HTTP verb and the handler signature is this
      // route's decorator block.
      const decorators: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (COMMENT.test(lines[j])) continue;
        if (DECORATOR.test(lines[j])) decorators.push(lines[j]);
        else if (HANDLER.test(lines[j])) break;
      }

      const route = { file, line: i + 1, signature: lines[i].trim() };
      all.push(route);
      // Per line, not against the joined block: POLICY is `^`-anchored and the
      // regex has no `m` flag, so testing the join would only ever match the
      // FIRST decorator of each route.
      if (!classPolicied && !decorators.some((d) => POLICY.test(d))) unpoliced.push(route);
    }
  }

  return { all, unpoliced };
}

function report(routes: Route[]): string {
  const byFile = new Map<string, string[]>();
  for (const r of routes) {
    byFile.set(r.file, [...(byFile.get(r.file) ?? []), `${r.signature}  (line ${r.line})`]);
  }
  return [...byFile.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([file, rs]) => `  ${file}\n${rs.map((r) => `      ${r}`).join('\n')}`)
    .join('\n');
}

describe('route-policy ratchet (only ever decreases)', () => {
  it('finds the controller surface it claims to guard', () => {
    const { all } = scanRoutes();
    expect(
      all.length,
      'Found almost no route handlers. The scanner is broken, not the controllers.',
    ).toBeGreaterThanOrEqual(MIN_ROUTES_FOUND);
  });

  it(`route handlers with neither @RequirePermission nor @Public <= ${MAX_UNPOLICED_ROUTES}`, () => {
    const { unpoliced } = scanRoutes();

    if (unpoliced.length > MAX_UNPOLICED_ROUTES) {
      throw new Error(
        `Unpoliced routes rose to ${unpoliced.length} (baseline ${MAX_UNPOLICED_ROUTES}).\n` +
          `PolicyGuard ALLOWS a handler with no policy metadata, so a new route ` +
          `without @RequirePermission is open to every authenticated caller. Add ` +
          `the decorator — do not raise the baseline.\n\n${report(unpoliced)}`,
      );
    }

    expect(unpoliced.length).toBeLessThanOrEqual(MAX_UNPOLICED_ROUTES);
  });
});
