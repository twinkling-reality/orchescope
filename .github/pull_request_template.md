## What this changes

<!-- One paragraph. What question does this let someone answer that they could not answer before, or what defect does it fix. -->

## Why

<!-- The reasoning. If this is a fix, what was the wrong behaviour and what made it wrong. -->

## Evidence

State what you ran and what it printed. A check you did not run is more useful reported as not run than implied to have
passed.

```
pnpm check
pnpm test
pnpm test:e2e
```

- [ ] `pnpm check` (format, lint, types, dependency direction, unused code, schema drift)
- [ ] `pnpm test`
- [ ] `pnpm test:e2e`
- [ ] `pnpm test:ui` (needed for anything touching the browser workspace)

For a change to discovery, paste the coverage block:

```
pnpm --silent orchescope --cwd apps/demo audit --json | node -e "..."
```

For a change to the report, say that you built the workspace and looked at the page.

## Tests

<!-- Which tests would fail without this change. A new rule needs one test that fires it and one that proves it stays quiet
without evidence. A new adapter needs a fixture and assertions on components, relations and evidence. -->

## Contract impact

- [ ] No persisted schema changed
- [ ] A schema changed, `pnpm schemas` was run, and the version was bumped if the change is not backward compatible
- [ ] No exit code, JSON field or MCP tool signature changed
- [ ] One of those changed, and the change is described above

## Claims

- [ ] Nothing in this change claims support for an ecosystem, platform or format that no test exercises
- [ ] No finding, metric or verdict added here reports more confidence than its evidence supports
- [ ] No new unbounded retry, queue, concurrency or output
- [ ] No `TODO`, `FIXME`, placeholder, temporal comment or em dash
