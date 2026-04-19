# AgentRig Registry

`agentrig-registry` is the authoritative public source of truth for the AgentRig registry contract.

It is a hard-cut repository:

- no legacy `manifests/` directory
- no flat `plugins/<plugin>/<version>` layout
- no compatibility shims or dual metadata paths
- no delivery artifacts, ZIPs, or alternate install sources

Public installability is modeled only from this static, git-mirrorable, signed registry shape.

## Canonical Layout

```text
registry.json
advisories.json
plugins/
  <namespace>/
    <plugin>/
      plugin.json
      versions/
        <version>/
          .plugin/plugin.json
          AGENTRIG_SOURCE.json
          AGENTRIG_LOCK.json
          AGENTRIG_REVIEW.json
          README.md
          LICENSE
          ...
```

Canonical plugin ids use `namespace.plugin`.

Canonical install refs use `<registryAlias>/<namespace.plugin>@<version>`.

## File Roles

- `registry.json`: top-level public registry index. It points at each plugin history file, names the active version path, and embeds the required signature envelope at `registry.json.signature`.
- `advisories.json`: the global machine-readable advisory state for blocked and yanked versions.
- `plugins/<namespace>/<plugin>/plugin.json`: the one canonical plugin-history document for that plugin.
- `plugins/<namespace>/<plugin>/versions/<version>/.plugin/plugin.json`: the per-version install manifest.
- `AGENTRIG_SOURCE.json`: upstream provenance and snapshot source metadata.
- `AGENTRIG_LOCK.json`: canonical file digests plus the deterministic version snapshot digest.
- `AGENTRIG_REVIEW.json`: trust-tier and review decision record.

The history file and the per-version manifest have different roles and are never interchangeable.

## Trust Model

The only valid trust tiers are:

- `official`
- `reviewed`
- `listed`
- `blocked`
- `yanked`

Derived installability is fixed by contract:

- `official` -> `installable`
- `reviewed` -> `installable`
- `listed` -> `discovery_only`
- `blocked` -> `blocked`
- `yanked` -> `yanked`

## Deterministic Build And Check Path

This repository uses one deterministic command path:

- `node scripts/validate-registry.mjs --write` synchronizes canonical derived JSON from the tree
- `node scripts/validate-registry.mjs --check` verifies there is no drift

The script is the only supported way to maintain:

- per-version digest fields in `AGENTRIG_SOURCE.json` and `AGENTRIG_LOCK.json`
- `plugins/*/*/plugin.json`
- `registry.json`

## Signing And Mirrors

The signable public artifact is `registry.json`.

The signature envelope lives at `registry.json.signature` and contains:

- `algorithm`
- `key_id`
- `target`
- `signed_digest`

CI requires that envelope to be present and correct. Mirrors may only redistribute exact byte copies of a validated registry state.

## Specifications

The frozen contract is described by:

- `docs/adr/0001-canonical-registry-contract.md`
- `schemas/registry-contract.definitions.json`
- `schemas/registry.schema.json`
- `schemas/plugin-history.schema.json`
- `schemas/agentrig-source.schema.json`
- `schemas/agentrig-lock.schema.json`
- `schemas/agentrig-review.schema.json`
- `schemas/advisories.schema.json`
