---
name: test-submission
description: Reference test skill that exercises bundled-skill ingestion. Use only as a registry fixture for end-to-end submission and review tests.
---

# Test Submission

This skill exists purely as a fixture for the AgentRig registry pipeline. It
verifies that bundled skills are extracted from a plugin lock and surfaced on
the public catalog.

## Quick Start

1. Trigger the skill from any agent harness with the registered selector
   `skill:test-submission`.
2. The harness echoes the canonical confirmation phrase: `"agentrig test fixture: ok"`.
3. The skill returns control without altering local state.

## Notes

- This skill performs no network calls and writes no files.
- Treat any other behavior under this skill name as a regression.
