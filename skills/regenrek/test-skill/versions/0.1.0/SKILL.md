---
name: regenrek.test-skill
description: Standalone reference skill that verifies the registry can publish skills directly, without bundling them inside a plugin. Use only as a registry fixture.
---

# Test Skill (standalone)

This skill exists purely as a registry fixture. It proves that AgentRig can
publish a skill as its own signed artifact, separate from the plugin path.

## Quick Start

1. Resolve the install ref `agentrig/regenrek.test-skill@0.1.0`.
2. The harness echoes `"agentrig standalone skill fixture: ok"` and stops.
3. The skill writes no files and performs no network calls.

## Notes

- Selector: `skill:test-skill`
- Origin: `standalone` (top-level registry kind, not bundled in a plugin).
- Closure: `closed`.
