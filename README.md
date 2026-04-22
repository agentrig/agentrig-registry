# AgentRig Registry

`agentrig-registry` is the public registry for installable AgentRig plugins.

If a plugin version is installable, this repository is where that decision and snapshot live.

## What is in this repo

- `registry.json` - top-level index and signed public entrypoint
- `advisories.json` - blocked and yanked versions
- `plugins/<namespace>/<plugin>/plugin.json` - history for one plugin
- `plugins/<namespace>/<plugin>/versions/<version>/` - one installable snapshot

Each version directory contains:

- `.plugin/plugin.json`
- `AGENTRIG_SOURCE.json`
- `AGENTRIG_LOCK.json`
- `AGENTRIG_REVIEW.json`
- `README.md`
- `LICENSE`

Plugin ids use `namespace.plugin`.

Install refs use `<registryAlias>/<namespace.plugin>@<version>`.

## Trust tiers

- `official` -> `installable`
- `reviewed` -> `installable`
- `listed` -> `discovery_only`
- `blocked` -> `blocked`
- `yanked` -> `yanked`

## Update and validate

Use the validator script for all derived files:

```bash
node scripts/validate-registry.mjs --write
node scripts/validate-registry.mjs --check
```

`--write` refreshes derived JSON from the checked-in tree.  
`--check` verifies that the repository is already in sync.

## Specs

The registry contract is defined in:

- `docs/adr/0001-canonical-registry-contract.md`
- `schemas/registry.schema.json`
- `schemas/plugin-history.schema.json`
- `schemas/agentrig-source.schema.json`
- `schemas/agentrig-lock.schema.json`
- `schemas/agentrig-review.schema.json`
- `schemas/advisories.schema.json`
