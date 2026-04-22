# ADR 0001: Canonical Registry Contract

## Status

Accepted.

## Decision

AgentRig has exactly one canonical public installability contract.

Publicly installable software must come from a registry that is:

- static
- git-mirrorable
- signed
- immutable at the version level

The authoritative source repository for the public world is `agentrig-registry`.

Mirrors and CDNs may redistribute exact bytes from a signed registry state, but they are never independent truth sources.

## Canonical Identity

The canonical plugin identity is `namespace.plugin`.

Rules:

- `namespace` uses lowercase letters, numbers, and hyphens
- `plugin` uses lowercase letters, numbers, and hyphens
- exactly one `.` separates namespace and plugin
- versions use SemVer

Canonical install refs use:

`<registryAlias>/<namespace.plugin>@<version>`

Canonical registry paths use:

`plugins/<namespace>/<plugin>/versions/<version>/`

The per-plugin history document lives at:

`plugins/<namespace>/<plugin>/plugin.json`

## Installable Sources

Installable:

- static signed registries that implement this contract

Not installable:

- Convex-hosted bytes
- direct author repositories
- direct GitHub URLs or repo refs
- ZIP uploads
- arbitrary HTTPS manifest URLs
- directory-only entries
- community upload buckets

These sources may still appear in discovery or submission workflows, but they never imply install trust.

## Trust Contract

The only valid trust tiers are:

- `official`
- `reviewed`
- `listed`
- `blocked`
- `yanked`

Operational meaning:

- `official`: installable
- `reviewed`: installable
- `listed`: discovery-only, not installable
- `blocked`: not installable and hard-blocked
- `yanked`: not available for new installs, retained only for historical and advisory use

`verified-author` is not a trust tier.

`verified-author` is identity or ownership metadata only.

Derived installability state is:

- `official` -> `installable`
- `reviewed` -> `installable`
- `listed` -> `discovery_only`
- `blocked` -> `blocked`
- `yanked` -> `yanked`

## Submission Contract

The only valid submission input is:

- `upstream_repo`
- `upstream_tag`
- `upstream_commit_sha`
- `plugin_path`

Required invariants:

- `upstream_tag` must resolve to `upstream_commit_sha`
- `plugin_path` is relative to the upstream repository root
- branches are forbidden
- `latest` is forbidden
- unpinned refs are forbidden

Submission is a review primitive only. Submission never makes bytes installable by itself.

## Required Registry Artifacts

Registry-wide:

- `registry.json`
- `advisories.json`

Per plugin:

- `plugins/<namespace>/<plugin>/plugin.json`

Per version:

- `.plugin/plugin.json`
- `AGENTRIG_SOURCE.json`
- `AGENTRIG_LOCK.json`
- `AGENTRIG_REVIEW.json`

Minimum required contents:

### `AGENTRIG_SOURCE.json`

- `upstream_repo`
- `upstream_tag`
- `upstream_commit`
- `plugin_path`
- `submitted_by`
- `snapshot_created_at`
- `snapshot_tree_digest`

Submission input uses `upstream_commit_sha`. That value maps directly to
`upstream_commit` in `AGENTRIG_SOURCE.json`.

### `AGENTRIG_LOCK.json`

- `plugin`
- `version`
- `file_digests`
- `capability_set`
- `declared_network_domains`
- `declared_secrets`
- `runtime_requirements`
- `dependencies`
- `snapshot_digest`

### `AGENTRIG_REVIEW.json`

- `review_status`
- `reviewer`
- `reviewed_at`
- `scanner_summary`
- `policy_decisions`
- `trust_tier_basis`

### `advisories.json`

The root document contains:

- `$schema`
- `generated_at`
- `items`

Each item in `items` contains:

- `id`
- `title`
- `published_at`
- `plugin`
- `affected_versions`
- `severity`
- `advisory_type`
- `remediation`
- `blocked`
- `yanked`

## Signature And Digest Contract

The following is frozen by contract:

- `registry.json` must be signed
- the signature envelope lives inside `registry.json` at the `signature` property
- `registry.json.signature.target` is always `registry.json`
- `registry.json.signature.signed_digest` is computed from the canonical unsigned registry payload
- plugin versions must be addressable by digest
- the CLI must never trust mutable registry JSON without verification
- mirrors and CDNs may only serve exact byte mirrors of signed registry states

The concrete publish-time signing service is follow-up work. The repository contract already fixes the signed artifact, the signature location, and the deterministic digest that CI must verify.

## Deterministic Derivation

`registry.json` and every `plugins/<namespace>/<plugin>/plugin.json` history document are derived from the canonical version tree plus `advisories.json`.

The repository maintains one deterministic command path:

- `node scripts/validate-registry.mjs --write`
- `node scripts/validate-registry.mjs --check`

That command path is responsible for:

- synchronizing per-version digest fields in `AGENTRIG_SOURCE.json` and `AGENTRIG_LOCK.json`
- regenerating plugin history documents
- regenerating `registry.json`
- proving that committed JSON has no drift from the tree

## Discovery Versus Installability

Discovery and installability are separate contracts.

Discovery may:

- show external repositories
- show `listed` projects
- link upstream sources
- offer "submit for review"

Discovery must not:

- render the same install CTA as `official` or `reviewed`
- imply installability
- derive code trust from profile or directory metadata

## Validation Rules

Consumers and producers must enforce these invariants:

1. Only canonical ids matching `namespace.plugin` are valid.
2. Only canonical install refs matching `<registryAlias>/<namespace.plugin>@<version>` are valid.
3. Only canonical registry paths matching `plugins/<namespace>/<plugin>/versions/<version>/` are valid.
4. Only canonical trust tiers are valid.
5. Only static signed registries are installable.
6. Submission inputs must be repo, tag, full commit SHA, and plugin path only.
7. Every published version must carry source, lock, and review artifacts.
8. Every published version must be digest-addressable.
9. Directory or discovery metadata must never be used as install trust.
10. `verified-author` and similar identity markers must stay orthogonal to install trust.

## Terminology Cleanup

These phrases are not canonical and must not be used as install contract language:

- "hosted community registry" as an install source
- "install from a ZIP upload"
- "install from direct URL"
- "install from author repo"
- "`listed` means installable"
- "`verified-author` is a trust tier"
- "Convex is the public artifact source"

## Consequences

- later CLI, Convex, and bot work must implement this contract exactly
- compatibility with old draft shapes is intentionally out of scope
- old shapes should be deleted or rewritten, not adapted
