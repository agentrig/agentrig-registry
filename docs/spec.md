# AgentRig Verified Mirror Spec

The registry is a derivative verified mirror of approved AgentRig catalog
listings. Canonical catalog state lives in Convex `artifact_listings`; the
SDK `InstallBundle` is the canonical install contract. A registry pull request
is derived from that bundle for public auditability and verification. CLI
install resolution fetches the bundle from AgentRig install APIs, not from
this mirror.

Related PlanDB parents: `t-ar-mkt-sdk`, `t-ar-mkt-convex`,
`t-ar-mkt-web`, `t-ar-mkt-cli`, and `t-ar-mkt-mirror`.

## Artifact Kinds

Registry items use one canonical kind axis:

- `plugin`
- `skill`
- `mcp`
- `hook`

Future SDK/web/CLI surfaces may add `command` and `agent`, but this registry
validator currently accepts installable standalone layouts for plugins, skills,
MCPs, and hooks.

`registry.json.items[].kind` selects the artifact kind. Plugin rows keep the
legacy `plugin` field as a compatibility alias; all rows use `artifact` as the
canonical id.

## Mirror Layout

```text
plugins/<namespace>/<plugin>/plugin.json
skills/<namespace>/<skill>/skill.json
mcps/<namespace>/<mcp>/mcp.json
hooks/<namespace>/<hook>/hook.json

<kind-root>/<namespace>/<artifact>/versions/<version>/
```

Each version directory contains the mirrored payload files plus provenance,
lock, and review documents serialized from the SDK `InstallBundle`:

```text
plugin.json
skills/<skill>/SKILL.md
mcp.json
ai.agentrig/
.skill/skill.json
.mcp/mcp.json
.hook/hook.json
AGENTRIG_SOURCE.json
AGENTRIG_LOCK.json
AGENTRIG_REVIEW.json
README.md
LICENSE
```

Root `plugin.json`, `skills/*/SKILL.md`, and `mcp.json` follow Agent Plugins
1.0.0. AgentRig extension metadata uses `extensions["ai.agentrig"]`, and
AgentRig-specific package files live under `ai.agentrig/`.

Exact immutable versions published before this cut may retain
`.plugin/plugin.json`; the validator uses an explicit version allowlist for
that historical boundary and never accepts it for a new version.

Standalone source artifacts use `artifact_kind` and `artifact_path`. Plugin
source artifacts use `plugin_path`. Lock files include SDK-owned
`file_digests[]` entries with `path`, `digest`, and `size`.

## Trust Boundary

AgentRig uses two separate GitHub Apps:

- `user-repo-sync` (`agentrig-repository-sync`) is the user-repo sync app. It is read-only
  (`Contents:Read`, `Metadata:Read`) and is installed by users on their own
  repositories for source fetch and scan flows.
- `registry-mirror` (`agentrig-repository-mirror`) is the registry mirror app. It has registry
  write and pull-request permissions only for `agentrig/agentrig-registry`
  and staging mirrors. Users never install this app.

Convex chooses the app profile explicitly at each GitHub App call site. The
mirror lane must never borrow the user-repo-sync installation token for writes.

## Installability

Installability is inherited from the Convex listing and SDK bundle:

- `available` listings may be mirrored.
- `yanked` or `taken_down` listings are not eligible for new mirror PRs.
- If a previously mirrored listing is later yanked or taken down, the mirror
  lane opens a follow-up PR that marks the mirrored registry entry as `yanked`.

## Bundled Artifacts

Skills, MCPs, and hooks bundled inside plugins are discovered from mirrored
plugin locks by `@agentrig/sdk`. They inherit the parent plugin mirror metadata
unless and until they have their own standalone mirrored entry.

Local selected-artifact installs are represented as AgentRig Selection Bundles. The
registry records mirror provenance; the SDK and CLI handle closure checks,
materialization metadata, hash verification, and install resolution through
the Convex listing endpoint.

## Validation

```bash
node scripts/validate-registry.mjs --check
```

The validator checks the committed mirror tree for deterministic structure:
registry item kind/id consistency, version history paths, manifest shapes,
source/lock fields, referenced standalone entry files, review artifacts, and
derived mirror output. It validates the derivative mirror, not install
authority.
