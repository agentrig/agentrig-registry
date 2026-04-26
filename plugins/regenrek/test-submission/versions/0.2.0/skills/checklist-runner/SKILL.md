---
name: checklist-runner
description: Reference test skill with a bundled script. Use only as a registry fixture to verify SDK closure detection on multi-file skills.
---

# Checklist Runner

Second bundled skill in the test plugin. It carries an additional file under
`scripts/` to verify that `@agentrig/sdk` closure detection treats the skill as
`closed` even when it bundles non-Markdown assets.

## Workflow

1. Read the checklist from `scripts/run.sh`.
2. Echo each step to the harness; never execute the script.
3. Stop after the last item without writing any state.

## Validation

- Selector: `skill:checklist-runner`
- Closure: `closed` (all files live under `skills/checklist-runner/`)
