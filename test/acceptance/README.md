# Acceptance tests

One directory, written to by agent-forge (see `docs/` in that project) and readable by anyone.

A story's acceptance tests land here rather than beside the code, for two reasons that are about the
process rather than about taste:

- **They are selected as a set.** The orchestrator runs exactly these while a story is in progress —
  first requiring them to fail, then requiring them to pass with the expected-failure markers removed.
  A predictable path makes that one command instead of a guess.
- **They are locked while a story runs.** Every task after the first is refused write access to these
  files: an implementation that can edit its own acceptance test can pass by rewriting the target.

Unit tests stay beside their subject, as they are everywhere else in this repository. These are the
tests that answer "did we build the thing the story asked for", which is a different question.

Written in the form the platform asks for, so both halves are machine-readable:

```ts
it.fails('[AC-1] rejects an expired card', () => {  // agent-forge: pending implementation
  expect(reject('2020-01')).toBe(true);
});
```

`[AC-1]` is the traceability tag — CI reads it to prove every acceptance criterion has a covering
test, and `vitest -t 'AC-1'` selects it. `it.fails` is removed by the orchestrator once the
implementation exists; a test that never failed first is not evidence that it tests anything.
