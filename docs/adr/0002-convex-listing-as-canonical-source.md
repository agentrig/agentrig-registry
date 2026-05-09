# ADR 0002: Convex artifact_listings as canonical install source

- Status: Accepted
- Date: 2026-05-09
- Supersedes: [ADR 0001](./0001-canonical-registry-contract.md)
- PlanDB epic: t-ar-mkt-listing-cut
- PlanDB parents: t-ar-mkt-sdk, t-ar-mkt-convex, t-ar-mkt-web, t-ar-mkt-cli, t-ar-mkt-mirror, t-ar-mkt-docs

## Context

The marketplace listing hard cut split one fused registry workflow into distinct
runtime ownership boundaries. The previous model created two approve paths,
treated registry-promotion-as-install-gate as part of review, and allowed
`agentrig-registry` state to stand in for marketplace product state. That made
approval semantics ambiguous: a submission could be approved for review purposes
without consistently materializing a marketplace listing, while browse and CLI
code compensated by reading registry-shaped JSON.

That design also created a trust and schema problem. A write-capable GitHub App
for registry PRs is not appropriate for user repositories, and the read-only
user repo sync app must never be reused for registry writes. Meanwhile, CLI,
web, and registry code each carried local copies of marketplace and registry
wire shapes, so contract drift could change install behavior without a single
source of truth.

## Decision

Convex `artifact_listings` plus the SDK `InstallBundle` is the canonical
marketplace install source. `agentrig-registry` is a derivative verified-mirror
lane: opt-in, admin-triggered, and used for transparency and audit only.

AgentRig now has two state machines:

- Submission lifecycle: `pending_review -> approved | rejected | blocked`.
  Approval materializes a Convex `artifact_listings` row with an SDK
  `InstallBundle`; rejected and blocked submissions do not resolve to install
  bundles.
- Registry-mirror lifecycle: an approved listing can be explicitly sent through
  **Start verified mirror**. The mirror lane queues work, opens a PR against
  `agentrig/agentrig-registry`, and records the resulting mirror status. This
  lifecycle does not gate CLI install.

AgentRig also uses two GitHub App profiles:

- `user-repo-sync` (`agentrig-repository-sync`) is read-only for user
  repositories and supports source fetch and scan flows.
- `registry-mirror` (`agentrig-repository-mirror`) is write-capable only for
  AgentRig-owned registry mirror repositories and is used to open mirror PRs.

The SDK owns `MarketplaceListing`, `InstallBundle`,
`ListingInstallResolution`, `SubmissionStatus`, and registry mirror
serialization helpers. Web and CLI import those contracts instead of declaring
local registry-shaped install models.

## Consequences

- Install authority moved off GitHub.
- Approve is decoupled from registry PR creation.
- Registry PRs are audit/transparency artifacts.
- Two-app trust boundary: users only ever install the read-only
  `agentrig-repository-sync` on their repos.
- CLI install lock includes `repo@sha + tree_sha + file_list[].sha256/size +
  scan_digest`; verifier rejects mismatch with explicit issue codes (`missing`,
  `duplicate`, `size_mismatch`, `sha256_mismatch`, `extra`).
- Yank/takedown is first-class (`installability: 'available' | 'yanked' |
  'taken_down'`); resolver refuses non-available; yank propagates to mirror PRs
  as `mark-as-yanked`.

## Rejected alternatives

- V2 "Auto-PR on every approve": high ops cost, GitHub App trust issue.
- V3 "Convex File Storage as install bytes": not needed; pointer +
  content-addressed lock is sufficient for v1.

## References

- Story log: `~/.planr/agentrig-mono/stories/0008-marketplace-listing-hard-cut.md`
- ClawHub validation: PlanDB context `c-f1sk` (alignment confirmed; ClawHub's
  `SkillVersion.files: [{path,size,storageId,sha256}]` validated our
  content-addressed approach)
- SDK contracts: `agentrig-public/packages/sdk/src/marketplace-listing.ts`

## 2026-05-09 Amendment: approval and mirror remain decoupled

- Status: still authoritative

The marketplace listing E2E review found that approve-vs-mirror separation must
be explicit in tests, admin copy, and operator docs. This ADR remains the source
of truth: approving a submission materializes or updates the Convex listing head
and its install bundle only. It must not enqueue `registry_promotion_runs`, start
the mirror workflow, or open a registry PR as a side effect.

Verified mirror remains an opt-in admin action from a materialized listing. The
admin action queues the mirror promotion and opens a PR in
`agentrig-registry-staging`; that PR is an audit/transparency artifact and does
not gate CLI install resolution.
