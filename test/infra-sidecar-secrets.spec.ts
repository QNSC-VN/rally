/**
 * A service running a sidecar must be allowed to read that sidecar's secrets.
 *
 * THIS IS THE TEST THAT WAS MISSING. Every develop deploy between 2026-08-10 and the
 * commit this file lands with failed, because the api task could not start:
 *
 *   ResourceInitializationError: unable to pull secrets or registry auth:
 *   AccessDeniedException: User: .../rally-develop-api-exec is not authorized to
 *   perform: secretsmanager:GetSecretValue on resource:
 *   .../secret:rally/develop/tunnel-token-tf-*
 *
 * The cf-tunnel adoption created the token as its own secret, outside `module.secrets`,
 * and wired the sidecar to it — but `local.secret_iam_arns` is built from the bundle and
 * standalone NAMES, so nothing granted the new ARN. The apply succeeded. Nothing failed
 * until a task tried to start.
 *
 * WHY IT WENT UNNOTICED FOR TWO DAYS is the part worth keeping: the deployment circuit
 * breaker rolled back, and a rollback leaves the PREVIOUS task definition serving. The
 * service stayed healthy on a stale image, `/v1/healthz` kept answering, and the only
 * signal was red deploy runs. The worker deployed normally throughout — it has no
 * sidecar — which is exactly what isolated the cause.
 *
 * WHY A TEST AND NOT A BETTER ABSTRACTION. `tunnel-agent` already publishes a
 * `secret_arns` output whose own description says "Concat into ecs-service's secret_arns,
 * or the task fails to start with ResourceInitializationError". The contract was written
 * down and simply not consumed. Consuming it here instead of naming the secret was tried
 * and REVERTED: the module gates that output on `enabled = var.tunnel_token_secret_arn
 * !== ""`, so in an environment where the secret does not exist yet the ARN is an unknown
 * attribute, the list's length is unknown, and `ecs-service`'s
 * `count = length(var.secret_arns) + ... > 0` cannot be computed — prod plans died on it.
 *
 * So the invariant is asserted here, and asserts THE PERMISSION IS PRESENT rather than
 * where it comes from. A test demanding the module output would push the next person into
 * the form that breaks planning.
 *
 * SCOPE. Exactly one sidecar in this stack reads a secret. The OTEL agent needs none, so
 * it is not listed. A second sidecar that does needs a line in SIDECARS_NEEDING_SECRETS;
 * that edit is the point, not an oversight.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const STACK = join(__dirname, '..', 'infra', 'modules', 'stack', 'main.tf');

/**
 * Marker appearing in a service's wiring -> substring its `secret_arns` must contain.
 *
 * `tunnel` and not `tunnel_token`, because two spellings both grant the permission:
 * `aws_secretsmanager_secret.tunnel_token[*].arn` (what this stack uses, and the only
 * plan-safe form) and `module.tunnel_api.secret_arns`. Pinning to one would make this a
 * style rule and would reject a correct-but-different grant.
 */
const SIDECARS_NEEDING_SECRETS: Record<string, string> = {
  'module.tunnel_api': 'tunnel',
};

/**
 * Split the stack into top-level `module "name" { ... }` blocks.
 *
 * Brace counting rather than a regex: a service block contains nested `{}` in its
 * `environment_vars` and `secrets` lists, so a lazy match stops at the first one and
 * every assertion below would pass on a truncated block.
 */
function moduleBlocks(source: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    const opening = /^module\s+"([^"]+)"\s*\{/.exec(line);
    if (!opening) return;

    let depth = 0;
    const collected: string[] = [];
    for (const text of lines.slice(index)) {
      depth += (text.match(/\{/g) ?? []).length - (text.match(/\}/g) ?? []).length;
      collected.push(text);
      if (depth === 0) break;
    }
    blocks.set(opening[1], collected.join('\n'));
  });

  return blocks;
}

/** The `secret_arns = ...` value, whether written on one line or across several. */
function secretArnsAssignment(block: string): string {
  const match = /^[ \t]*secret_arns\s*=\s*([\s\S]*?)(?=^[ \t]*\w+\s*=|$(?![\s\S]))/m.exec(block);
  return match ? match[1] : '';
}

function servicesRunning(marker: string, blocks: Map<string, string>): string[] {
  return [...blocks.entries()]
    .filter(([, block]) => block.includes(marker) && block.includes('additional_containers'))
    .map(([name]) => name);
}

describe('a service running a sidecar grants its secrets', () => {
  const blocks = moduleBlocks(readFileSync(STACK, 'utf8'));

  it('parses the stack into module blocks', () => {
    expect(blocks.size).toBeGreaterThan(0);
  });

  it('does not stop at a nested brace', () => {
    // `environment_vars`/`secrets` are lists of objects, so a block truncated at the
    // first `}` would still contain `additional_containers` and pass everything below
    // while checking almost nothing.
    const api = blocks.get('api') ?? '';
    expect((api.match(/\{/g) ?? []).length).toBe((api.match(/\}/g) ?? []).length);
    expect(api).toContain('environment_vars');
    expect(api).toContain('secret_arns');
  });

  for (const [marker, required] of Object.entries(SIDECARS_NEEDING_SECRETS)) {
    const running = servicesRunning(marker, blocks);

    it(`finds the service running ${marker}`, () => {
      // An empty result must not pass silently — that is indistinguishable from the
      // omission this test exists to catch. If the sidecar was removed, drop it from
      // SIDECARS_NEEDING_SECRETS; if renamed, update the marker.
      expect(running.length).toBeGreaterThan(0);
    });

    for (const service of running) {
      it(`grants ${marker}'s secrets to module "${service}"`, () => {
        expect(
          secretArnsAssignment(blocks.get(service) ?? ''),
          `module "${service}" runs the ${marker} sidecar but its secret_arns does not ` +
            `mention \`${required}\`. The execution role cannot read the secret, so ECS ` +
            `cannot start the task: ResourceInitializationError, then a circuit-breaker ` +
            `rollback that leaves the OLD task definition serving and the service ` +
            `reporting healthy. This broke develop for two days.`,
        ).toContain(required);
      });
    }
  }

  it('fails when the grant is removed', () => {
    // A guard that cannot fail is not a guard. Strips whichever spelling is in use, so
    // this keeps proving the point if the grant is ever rewritten in the other form.
    const granted = secretArnsAssignment(blocks.get(servicesRunning('module.tunnel_api', blocks)[0]) ?? '');
    expect(granted).toContain('tunnel');
    expect(granted.replace(/\S*tunnel\S*/g, '')).not.toContain('tunnel');
  });
});
