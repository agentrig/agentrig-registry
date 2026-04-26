#!/usr/bin/env bash
# Reference fixture script. Never executed automatically; the skill reads it
# as data so we can verify SDK closure handling for multi-file bundled skills.
set -euo pipefail

cat <<'EOF'
1. confirm registry fixture metadata
2. confirm provider materialization metadata
3. confirm uninstall ledger entries
EOF
