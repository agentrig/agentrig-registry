# AgentRig Registry

`agentrig-registry` is the public registry for installable AgentRig artifacts.

If a plugin, skill, MCP, or hook version is installable, this repository is where that decision and snapshot live.

Repo inspection, discovery submissions, and `agentrig use <owner/repo>` are not registry installs.
They may record external-repo provenance, but they do not create registry trust.

## What is in this repo

- `registry.json` - top-level index and signed public entrypoint, including the `signature` object
- `advisories.json` - blocked and yanked versions
- `plugins/<namespace>/<plugin>/plugin.json` - history for one plugin
- `skills/<namespace>/<skill>/skill.json` - history for one standalone skill
- `mcps/<namespace>/<mcp>/mcp.json` - history for one standalone MCP
- `hooks/<namespace>/<hook>/hook.json` - history for one standalone hook
- `<kind-root>/<namespace>/<artifact>/versions/<version>/` - one signed version snapshot

Each version directory contains:

- `.plugin/plugin.json`
- or `.skill/skill.json`, `.mcp/mcp.json`, `.hook/hook.json` for standalone artifacts
- `AGENTRIG_SOURCE.json`
- `AGENTRIG_LOCK.json`
- `AGENTRIG_REVIEW.json`
- `README.md`
- `LICENSE`

Artifact ids use `namespace.artifact`.

Install refs use `<registryAlias>/<namespace.artifact>@<version>`, with `registry.json.items[].kind`
selecting the artifact kind. Plugin rows keep the legacy `plugin` alias for back-compat.

## Trust tiers

- `official` -> `installable`
- `reviewed` -> `installable`
- `listed` -> `discovery_only`
- `blocked` -> `blocked`
- `yanked` -> `yanked`

Only `official` and `reviewed` entries are installable. Discovery rows, profile ownership,
AI-enriched descriptions, and scanned external repositories stay outside the signed install
contract until a version snapshot lands in this repository and passes validation.

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
- `schemas/skill-manifest.schema.json`
- `schemas/mcp-manifest.schema.json`
- `schemas/hook-manifest.schema.json`
- `schemas/agentrig-source.schema.json`
- `schemas/agentrig-lock.schema.json`
- `schemas/agentrig-review.schema.json`
- `schemas/advisories.schema.json`
