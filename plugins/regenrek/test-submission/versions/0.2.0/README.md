# regenrek.test-submission

Reference test plugin used by the AgentRig registry to verify ingestion of
bundled artifacts (skills, MCP servers, hooks). It is intentionally small but
covers every kind a plugin can bundle.

## Layout

```
.plugin/plugin.json          Plugin manifest
skills/test-submission/      Bundled skill 1
skills/checklist-runner/     Bundled skill 2 (with scripts/run.sh)
.mcp.json                    Bundled MCP server config
hooks/hooks.json             Bundled hook config
```

Source: https://github.com/regenrek/agentrig-test-plugin (v0.2.0).
