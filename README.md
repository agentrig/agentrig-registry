# AgentRig Registry

Official reviewed plugin registry for AgentRig.

## Canonical Source Layout

The canonical source of truth in this repo is:

- `registry.json`
- `manifests/<plugin-id>.json`
- `plugins/<plugin-id>/<version>/...`

There are no committed root `<pluginId>.json` install manifests in this repo.

## Hard Cut

- No root plugin manifest fallbacks.
- No compat shims or second install-optimized source of truth.
- Discovery is canonical only:
  - `registry.json -> manifests/<id>.json -> paths.plugin -> plugins/<id>/<version>/.plugin/plugin.json`
- If runtime delivery needs file inventory or optional integrity metadata, that is generated as a derived build artifact in `.plugin/install.json`, not committed as canonical source metadata.
