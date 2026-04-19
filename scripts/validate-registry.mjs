#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REGISTRY_SCHEMA_URL = 'https://agentrig.ai/schema/registry.json'
const PLUGIN_SCHEMA_URL = 'https://agentrig.ai/schema/plugin.v1.json'
const PLUGIN_HISTORY_SCHEMA_URL = 'https://agentrig.ai/schema/plugin-history.json'
const ADVISORIES_SCHEMA_URL = 'https://agentrig.ai/schema/advisories.json'
const SOURCE_SCHEMA_URL = 'https://agentrig.ai/schema/agentrig-source.json'
const LOCK_SCHEMA_URL = 'https://agentrig.ai/schema/agentrig-lock.json'
const REVIEW_SCHEMA_URL = 'https://agentrig.ai/schema/agentrig-review.json'

const REGISTRY_ALIAS = 'agentrig'
const SOURCE_REPOSITORY = 'https://github.com/agentrig/agentrig-registry'
const SIGNATURE_ALGORITHM = 'sha256-json-envelope'
const SIGNATURE_KEY_ID = 'agentrig-registry'
const SIGNATURE_TARGET = 'registry.json'

const NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const PLUGIN_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const FULL_COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/
const RELATIVE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/).+$/

const TRUST_TIER_TO_INSTALLABILITY = {
  official: 'installable',
  reviewed: 'installable',
  listed: 'discovery_only',
  blocked: 'blocked',
  yanked: 'yanked',
}

const VALID_TRUST_TIERS = new Set(Object.keys(TRUST_TIER_TO_INSTALLABILITY))
const VALID_INSTALLABILITY_STATES = new Set(Object.values(TRUST_TIER_TO_INSTALLABILITY))
const VALID_REVIEW_STATUS = new Set(['pending', 'approved', 'rejected', 'blocked', 'yanked'])
const VALID_SCANNER_STATUS = new Set(['pass', 'warn', 'fail'])
const VALID_ADVISORY_SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])
const VALID_ADVISORY_TYPES = new Set(['security', 'integrity', 'policy', 'malware', 'legal', 'deprecation', 'other'])

const ROOT_ALLOWED_ENTRIES = new Set([
  '.github',
  'LICENSE',
  'README.md',
  'advisories.json',
  'docs',
  'plugins',
  'registry.json',
  'schemas',
  'scripts',
])

const BLOCKED_ROOT_ENTRIES = new Set(['manifests'])
const REQUIRED_VERSION_FILES = new Set([
  'AGENTRIG_LOCK.json',
  'AGENTRIG_REVIEW.json',
  'AGENTRIG_SOURCE.json',
  'LICENSE',
  'README.md',
])
const BLOCKED_DELIVERY_FILENAMES = new Set(['install.json'])
const BLOCKED_DELIVERY_EXTENSIONS = ['.tgz', '.tar.gz', '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar']
const BLOCKED_DELIVERY_NAME_PATTERNS = [
  /^checksums?(\.[a-z0-9]+)?$/i,
  /^artifacts?$/i,
  /^bundle$/i,
  /^dist$/i,
  /^release$/i,
  /^build$/i,
  /^out$/i,
  /^coverage$/i,
  /^node_modules$/i,
  /^\.next$/i,
  /^\.turbo$/i,
  /^\.cache$/i,
]
const DIGEST_EXCLUDED_RELATIVE_PATHS = new Set([
  'AGENTRIG_LOCK.json',
  'AGENTRIG_REVIEW.json',
  'AGENTRIG_SOURCE.json',
])
const VERSION_RECORD_FIELDS = ['version', 'path', 'manifest', 'source', 'lock', 'review', 'trust_tier', 'installability', 'snapshot_digest', 'published_at']

function fail(message) {
  throw new Error(message)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function assertPlainObject(value, where) {
  assert(isPlainObject(value), `Invalid ${where}: expected an object`)
}

function assertString(value, where) {
  assert(typeof value === 'string' && value.trim(), `Invalid ${where}: expected a non-empty string`)
}

function assertOptionalString(value, where) {
  assert(value === undefined || (typeof value === 'string' && value.trim()), `Invalid ${where}: expected an omitted or non-empty string`)
}

function assertArray(value, where) {
  assert(Array.isArray(value), `Invalid ${where}: expected an array`)
}

function assertBoolean(value, where) {
  assert(typeof value === 'boolean', `Invalid ${where}: expected a boolean`)
}

function assertSetMember(value, allowed, where) {
  assert(allowed.has(value), `Invalid ${where}: got "${value}"`)
}

function assertPattern(value, pattern, where) {
  assert(pattern.test(value), `Invalid ${where}: got "${value}"`)
}

function assertUri(value, where) {
  assertString(value, where)
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    fail(`Invalid ${where}: expected a valid URI`)
  }
  assert(parsed.protocol === 'http:' || parsed.protocol === 'https:', `Invalid ${where}: expected an http/https URI`)
}

function assertDateTime(value, where) {
  assertString(value, where)
  const parsed = Date.parse(value)
  assert(Number.isFinite(parsed), `Invalid ${where}: expected an ISO date-time string`)
}

function assertAdditionalProperties(value, allowedKeys, where) {
  for (const key of Object.keys(value)) {
    assert(allowedKeys.has(key), `Invalid ${where}: unexpected field "${key}"`)
  }
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join(path.posix.sep)
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortKeys(child)]),
    )
  }
  return value
}

function stableJson(value) {
  return JSON.stringify(sortKeys(value))
}

function stableJsonPretty(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, stableJsonPretty(value))
}

async function ensureRegularFile(filePath, label) {
  const stat = await fs.lstat(filePath)
  assert(!stat.isSymbolicLink(), `${label} must be a regular file, not a symlink`)
  assert(stat.isFile(), `${label} must be a regular file`)
}

async function ensureDirectory(dirPath, label) {
  const stat = await fs.lstat(dirPath)
  assert(!stat.isSymbolicLink(), `${label} must be a directory, not a symlink`)
  assert(stat.isDirectory(), `${label} must be a directory`)
}

function parseSemver(version) {
  const match = version.match(SEMVER_PATTERN)
  assert(match, `Invalid semver: ${version}`)
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4]?.split('.') ?? [],
  }
}

function compareSemverIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) return Number.parseInt(left, 10) - Number.parseInt(right, 10)
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left.localeCompare(right)
}

function compareSemver(left, right) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (!a.prerelease.length && !b.prerelease.length) return 0
  if (!a.prerelease.length) return 1
  if (!b.prerelease.length) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart == null) return -1
    if (rightPart == null) return 1
    const comparison = compareSemverIdentifiers(leftPart, rightPart)
    if (comparison !== 0) return comparison
  }
  return 0
}

function sha256Hex(input) {
  const hash = createHash('sha256')
  hash.update(input)
  return `sha256:${hash.digest('hex')}`
}

function digestObject(value) {
  return sha256Hex(stableJson(value))
}

function mapInstallability(trustTier) {
  const installability = TRUST_TIER_TO_INSTALLABILITY[trustTier]
  assert(installability, `Unsupported trust tier "${trustTier}"`)
  return installability
}

function maybeArray(value) {
  return Array.isArray(value) && value.length ? value : undefined
}

function isDeliveryArtifact(name) {
  const lower = name.toLowerCase()
  if (BLOCKED_DELIVERY_FILENAMES.has(lower)) return true
  if (BLOCKED_DELIVERY_EXTENSIONS.some((extension) => lower.endsWith(extension))) return true
  if (BLOCKED_DELIVERY_NAME_PATTERNS.some((pattern) => pattern.test(name))) return true
  return false
}

async function listEntries(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  return entries.sort((left, right) => left.name.localeCompare(right.name))
}

async function listPayloadFiles(versionDir, relativeDir = '') {
  const targetDir = relativeDir ? path.join(versionDir, relativeDir) : versionDir
  const entries = await listEntries(targetDir)
  const files = []

  for (const entry of entries) {
    const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name
    const absolutePath = path.join(versionDir, relativePath)
    const posixPath = toPosix(relativePath)

    if (entry.isSymbolicLink()) {
      fail(`Invalid ${versionDir}: symbolic links are forbidden (found ${posixPath})`)
    }

    if (isDeliveryArtifact(entry.name)) {
      fail(`Invalid ${versionDir}: delivery artifact "${posixPath}" is forbidden`)
    }

    if (entry.isDirectory()) {
      files.push(...(await listPayloadFiles(versionDir, relativePath)))
      continue
    }

    if (!entry.isFile()) {
      fail(`Invalid ${versionDir}: unsupported filesystem entry "${posixPath}"`)
    }

    if (DIGEST_EXCLUDED_RELATIVE_PATHS.has(posixPath)) {
      continue
    }

    files.push({ absolutePath, relativePath: posixPath })
  }

  return files
}

async function computeVersionDigests(versionDir) {
  const files = await listPayloadFiles(versionDir)
  const fileDigests = []

  for (const file of files) {
    const content = await fs.readFile(file.absolutePath)
    fileDigests.push({
      path: file.relativePath,
      digest: sha256Hex(content),
    })
  }

  fileDigests.sort((left, right) => left.path.localeCompare(right.path))
  const snapshotDigest = digestObject(fileDigests)
  return { fileDigests, snapshotDigest }
}

function validateStringArray(items, where) {
  assertArray(items, where)
  for (let index = 0; index < items.length; index += 1) {
    assertString(items[index], `${where}[${index}]`)
  }
}

function validateFileDigests(fileDigests, where) {
  assertArray(fileDigests, where)
  const seenPaths = new Set()
  let lastPath = null
  for (let index = 0; index < fileDigests.length; index += 1) {
    const item = fileDigests[index]
    const itemWhere = `${where}[${index}]`
    assertPlainObject(item, itemWhere)
    assertAdditionalProperties(item, new Set(['path', 'digest']), itemWhere)
    assertString(item.path, `${itemWhere}.path`)
    assertPattern(item.path, RELATIVE_PATH_PATTERN, `${itemWhere}.path`)
    assertPattern(item.digest, SHA256_PATTERN, `${itemWhere}.digest`)
    assert(!DIGEST_EXCLUDED_RELATIVE_PATHS.has(item.path), `Invalid ${itemWhere}.path: ${item.path} is derived and must not be digest-addressed`)
    assert(!seenPaths.has(item.path), `Invalid ${where}: duplicate digest path "${item.path}"`)
    if (lastPath != null) {
      assert(lastPath.localeCompare(item.path) < 0, `Invalid ${where}: file_digests must be sorted by path`)
    }
    seenPaths.add(item.path)
    lastPath = item.path
  }
}

function validatePluginManifest(manifest, pluginId, version, where) {
  assertPlainObject(manifest, where)
  assertAdditionalProperties(
    manifest,
    new Set(['$schema', 'kind', 'id', 'name', 'description', 'version', 'author', 'license', 'keywords', 'pluginDependencies', 'configSchema', 'x-agentrig']),
    where,
  )
  if ('$schema' in manifest) {
    assert(manifest.$schema === PLUGIN_SCHEMA_URL, `Invalid ${where}.$schema: expected "${PLUGIN_SCHEMA_URL}"`)
  }
  assert(manifest.kind === 'agentrig:plugin', `Invalid ${where}.kind: expected "agentrig:plugin"`)
  assert(manifest.id === pluginId, `Invalid ${where}.id: expected "${pluginId}"`)
  assert(manifest.version === version, `Invalid ${where}.version: expected "${version}"`)
  assertString(manifest.name, `${where}.name`)
  assertString(manifest.description, `${where}.description`)
  assertOptionalString(manifest.author, `${where}.author`)
  assertOptionalString(manifest.license, `${where}.license`)
  assertPattern(manifest.id, PLUGIN_ID_PATTERN, `${where}.id`)
  assertPattern(manifest.version, SEMVER_PATTERN, `${where}.version`)

  if ('keywords' in manifest) validateStringArray(manifest.keywords, `${where}.keywords`)

  if ('pluginDependencies' in manifest) {
    validateStringArray(manifest.pluginDependencies, `${where}.pluginDependencies`)
    for (let index = 0; index < manifest.pluginDependencies.length; index += 1) {
      assertPattern(manifest.pluginDependencies[index], PLUGIN_ID_PATTERN, `${where}.pluginDependencies[${index}]`)
    }
  }

  assertPlainObject(manifest.configSchema, `${where}.configSchema`)

  if ('x-agentrig' in manifest) {
    assertPlainObject(manifest['x-agentrig'], `${where}.x-agentrig`)
  }
}

function canonicalizeSourceArtifact(artifact, expectedSnapshotDigest, where) {
  assertPlainObject(artifact, where)
  assertAdditionalProperties(
    artifact,
    new Set(['$schema', 'upstream_repo', 'upstream_tag', 'upstream_commit', 'plugin_path', 'submitted_by', 'snapshot_created_at', 'snapshot_tree_digest']),
    where,
  )
  if ('$schema' in artifact) {
    assert(artifact.$schema === SOURCE_SCHEMA_URL, `Invalid ${where}.$schema: expected "${SOURCE_SCHEMA_URL}"`)
  }
  assertUri(artifact.upstream_repo, `${where}.upstream_repo`)
  assertString(artifact.upstream_tag, `${where}.upstream_tag`)
  assertPattern(artifact.upstream_commit, FULL_COMMIT_SHA_PATTERN, `${where}.upstream_commit`)
  assertString(artifact.plugin_path, `${where}.plugin_path`)
  assertPattern(artifact.plugin_path, RELATIVE_PATH_PATTERN, `${where}.plugin_path`)
  assertString(artifact.submitted_by, `${where}.submitted_by`)
  assertDateTime(artifact.snapshot_created_at, `${where}.snapshot_created_at`)
  if ('snapshot_tree_digest' in artifact) {
    assertPattern(artifact.snapshot_tree_digest, SHA256_PATTERN, `${where}.snapshot_tree_digest`)
  }
  return sortKeys({
    $schema: SOURCE_SCHEMA_URL,
    upstream_repo: artifact.upstream_repo,
    upstream_tag: artifact.upstream_tag,
    upstream_commit: artifact.upstream_commit,
    plugin_path: artifact.plugin_path,
    submitted_by: artifact.submitted_by,
    snapshot_created_at: artifact.snapshot_created_at,
    snapshot_tree_digest: expectedSnapshotDigest,
  })
}

function canonicalizeLockArtifact(artifact, pluginId, version, expectedFileDigests, expectedSnapshotDigest, where) {
  assertPlainObject(artifact, where)
  assertAdditionalProperties(
    artifact,
    new Set(['$schema', 'plugin', 'version', 'file_digests', 'capability_set', 'declared_network_domains', 'declared_secrets', 'runtime_requirements', 'dependencies', 'snapshot_digest']),
    where,
  )
  if ('$schema' in artifact) {
    assert(artifact.$schema === LOCK_SCHEMA_URL, `Invalid ${where}.$schema: expected "${LOCK_SCHEMA_URL}"`)
  }
  assert(artifact.plugin === pluginId, `Invalid ${where}.plugin: expected "${pluginId}"`)
  assert(artifact.version === version, `Invalid ${where}.version: expected "${version}"`)
  validateFileDigests(artifact.file_digests, `${where}.file_digests`)
  validateStringArray(artifact.capability_set, `${where}.capability_set`)
  validateStringArray(artifact.declared_network_domains, `${where}.declared_network_domains`)
  validateStringArray(artifact.declared_secrets, `${where}.declared_secrets`)
  validateStringArray(artifact.runtime_requirements, `${where}.runtime_requirements`)
  assertArray(artifact.dependencies, `${where}.dependencies`)
  for (let index = 0; index < artifact.dependencies.length; index += 1) {
    const dependency = artifact.dependencies[index]
    const dependencyWhere = `${where}.dependencies[${index}]`
    assertPlainObject(dependency, dependencyWhere)
    assertAdditionalProperties(dependency, new Set(['plugin', 'version']), dependencyWhere)
    assertPattern(dependency.plugin, PLUGIN_ID_PATTERN, `${dependencyWhere}.plugin`)
    assertPattern(dependency.version, SEMVER_PATTERN, `${dependencyWhere}.version`)
  }
  if ('snapshot_digest' in artifact) {
    assertPattern(artifact.snapshot_digest, SHA256_PATTERN, `${where}.snapshot_digest`)
  }
  return sortKeys({
    $schema: LOCK_SCHEMA_URL,
    plugin: pluginId,
    version,
    file_digests: expectedFileDigests,
    capability_set: artifact.capability_set,
    declared_network_domains: artifact.declared_network_domains,
    declared_secrets: artifact.declared_secrets,
    runtime_requirements: artifact.runtime_requirements,
    dependencies: artifact.dependencies,
    snapshot_digest: expectedSnapshotDigest,
  })
}

function validateReviewArtifact(artifact, where) {
  assertPlainObject(artifact, where)
  assertAdditionalProperties(
    artifact,
    new Set(['$schema', 'review_status', 'reviewer', 'reviewed_at', 'scanner_summary', 'policy_decisions', 'trust_tier_basis']),
    where,
  )
  if ('$schema' in artifact) {
    assert(artifact.$schema === REVIEW_SCHEMA_URL, `Invalid ${where}.$schema: expected "${REVIEW_SCHEMA_URL}"`)
  }
  assertSetMember(artifact.review_status, VALID_REVIEW_STATUS, `${where}.review_status`)
  assertString(artifact.reviewer, `${where}.reviewer`)
  assertDateTime(artifact.reviewed_at, `${where}.reviewed_at`)
  assertPlainObject(artifact.scanner_summary, `${where}.scanner_summary`)
  assertAdditionalProperties(artifact.scanner_summary, new Set(['status', 'findings']), `${where}.scanner_summary`)
  assertSetMember(artifact.scanner_summary.status, VALID_SCANNER_STATUS, `${where}.scanner_summary.status`)
  if ('findings' in artifact.scanner_summary) validateStringArray(artifact.scanner_summary.findings, `${where}.scanner_summary.findings`)
  validateStringArray(artifact.policy_decisions, `${where}.policy_decisions`)
  assertPlainObject(artifact.trust_tier_basis, `${where}.trust_tier_basis`)
  assertAdditionalProperties(artifact.trust_tier_basis, new Set(['trust_tier', 'installability', 'rationale']), `${where}.trust_tier_basis`)
  assertSetMember(artifact.trust_tier_basis.trust_tier, VALID_TRUST_TIERS, `${where}.trust_tier_basis.trust_tier`)
  assertSetMember(artifact.trust_tier_basis.installability, VALID_INSTALLABILITY_STATES, `${where}.trust_tier_basis.installability`)
  assert(
    artifact.trust_tier_basis.installability === mapInstallability(artifact.trust_tier_basis.trust_tier),
    `Invalid ${where}.trust_tier_basis.installability: expected "${mapInstallability(artifact.trust_tier_basis.trust_tier)}"`,
  )
  assertString(artifact.trust_tier_basis.rationale, `${where}.trust_tier_basis.rationale`)
}

function validateAdvisoriesDocument(advisories, pluginVersionLookup) {
  const where = 'advisories.json'
  assertPlainObject(advisories, where)
  assertAdditionalProperties(advisories, new Set(['$schema', 'generated_at', 'items']), where)
  if ('$schema' in advisories) {
    assert(advisories.$schema === ADVISORIES_SCHEMA_URL, `Invalid ${where}.$schema: expected "${ADVISORIES_SCHEMA_URL}"`)
  }
  assertDateTime(advisories.generated_at, `${where}.generated_at`)
  assertArray(advisories.items, `${where}.items`)

  const advisoryIds = new Set()
  let latestPublishedAt = null

  advisories.items.forEach((item, index) => {
    const itemWhere = `${where}.items[${index}]`
    assertPlainObject(item, itemWhere)
    assertAdditionalProperties(item, new Set(['id', 'title', 'published_at', 'plugin', 'affected_versions', 'severity', 'advisory_type', 'remediation', 'replacement', 'blocked', 'yanked']), itemWhere)
    assertString(item.id, `${itemWhere}.id`)
    assert(!advisoryIds.has(item.id), `Invalid ${where}: duplicate advisory id "${item.id}"`)
    advisoryIds.add(item.id)
    assertString(item.title, `${itemWhere}.title`)
    assertDateTime(item.published_at, `${itemWhere}.published_at`)
    latestPublishedAt = latestPublishedAt == null || item.published_at > latestPublishedAt ? item.published_at : latestPublishedAt
    assertPattern(item.plugin, PLUGIN_ID_PATTERN, `${itemWhere}.plugin`)
    assertArray(item.affected_versions, `${itemWhere}.affected_versions`)
    assert(item.affected_versions.length > 0, `Invalid ${itemWhere}.affected_versions: expected at least one affected version`)
    item.affected_versions.forEach((version, versionIndex) => {
      assertPattern(version, SEMVER_PATTERN, `${itemWhere}.affected_versions[${versionIndex}]`)
      const knownVersions = pluginVersionLookup.get(item.plugin)
      assert(knownVersions?.has(version), `Invalid ${itemWhere}.affected_versions[${versionIndex}]: unknown version "${version}"`)
    })
    assertSetMember(item.severity, VALID_ADVISORY_SEVERITIES, `${itemWhere}.severity`)
    assertSetMember(item.advisory_type, VALID_ADVISORY_TYPES, `${itemWhere}.advisory_type`)
    assertString(item.remediation, `${itemWhere}.remediation`)
    if ('replacement' in item) {
      assertPattern(item.replacement, PLUGIN_ID_PATTERN, `${itemWhere}.replacement`)
      assert(pluginVersionLookup.has(item.replacement), `Invalid ${itemWhere}.replacement: unknown plugin "${item.replacement}"`)
    }
    assertBoolean(item.blocked, `${itemWhere}.blocked`)
    assertBoolean(item.yanked, `${itemWhere}.yanked`)
    assert(!(item.blocked && item.yanked), `Invalid ${itemWhere}: blocked and yanked cannot both be true`)
  })

  const expectedGeneratedAt = latestPublishedAt ?? '1970-01-01T00:00:00Z'
  assert(advisories.generated_at === expectedGeneratedAt, `Invalid ${where}.generated_at: expected "${expectedGeneratedAt}"`)
  return advisories.items
}

function makeActiveVersionRecord(versionRecord) {
  return Object.fromEntries(VERSION_RECORD_FIELDS.map((field) => [field, versionRecord[field]]))
}

function generateHistoryDocument(pluginMeta) {
  const latestVersionRecord = pluginMeta.versions[0]
  return sortKeys({
    $schema: PLUGIN_HISTORY_SCHEMA_URL,
    plugin: pluginMeta.pluginId,
    namespace: pluginMeta.namespace,
    name: pluginMeta.name,
    description: pluginMeta.description,
    latest_version: latestVersionRecord.version,
    trust_tier: latestVersionRecord.trust_tier,
    installability: latestVersionRecord.installability,
    active_version: makeActiveVersionRecord(latestVersionRecord),
    keywords: maybeArray(pluginMeta.keywords),
    advisories: maybeArray(pluginMeta.advisoryIds),
    versions: pluginMeta.versions.map((versionRecord) => Object.fromEntries(VERSION_RECORD_FIELDS.map((field) => [field, versionRecord[field]]))),
  })
}

function validateHistoryDocument(history, pluginMeta, expectedHistoryPath) {
  const where = expectedHistoryPath
  const expected = generateHistoryDocument(pluginMeta)
  assertPlainObject(history, where)
  assertAdditionalProperties(history, new Set(['$schema', 'plugin', 'namespace', 'name', 'description', 'latest_version', 'trust_tier', 'installability', 'active_version', 'keywords', 'advisories', 'versions']), where)
  if ('$schema' in history) {
    assert(history.$schema === PLUGIN_HISTORY_SCHEMA_URL, `Invalid ${where}.$schema: expected "${PLUGIN_HISTORY_SCHEMA_URL}"`)
  }
  assertPattern(history.plugin, PLUGIN_ID_PATTERN, `${where}.plugin`)
  assertPattern(history.namespace, NAMESPACE_PATTERN, `${where}.namespace`)
  assertString(history.name, `${where}.name`)
  assertString(history.description, `${where}.description`)
  assertPattern(history.latest_version, SEMVER_PATTERN, `${where}.latest_version`)
  assertSetMember(history.trust_tier, VALID_TRUST_TIERS, `${where}.trust_tier`)
  assertSetMember(history.installability, VALID_INSTALLABILITY_STATES, `${where}.installability`)
  assert(history.installability === mapInstallability(history.trust_tier), `Invalid ${where}.installability: expected "${mapInstallability(history.trust_tier)}"`)
  assertPlainObject(history.active_version, `${where}.active_version`)
  if ('keywords' in history) validateStringArray(history.keywords, `${where}.keywords`)
  if ('advisories' in history) validateStringArray(history.advisories, `${where}.advisories`)
  assertArray(history.versions, `${where}.versions`)
  assert(history.versions.length > 0, `Invalid ${where}.versions: expected at least one version`)
  assert(stableJson(history) === stableJson(expected), `Invalid ${where}: history document does not match the canonical plugin tree`)
  return expected
}

function generateRegistryDocument(registryItems, generatedAt) {
  const payload = sortKeys({
    $schema: REGISTRY_SCHEMA_URL,
    contract_version: '1',
    registry_alias: REGISTRY_ALIAS,
    source_repository: SOURCE_REPOSITORY,
    generated_at: generatedAt,
    items: registryItems,
  })
  return sortKeys({
    ...payload,
    signature: {
      algorithm: SIGNATURE_ALGORITHM,
      key_id: SIGNATURE_KEY_ID,
      target: SIGNATURE_TARGET,
      signed_digest: digestObject(payload),
    },
  })
}

function validateRegistryDocument(registry, expectedRegistry) {
  const where = 'registry.json'
  assertPlainObject(registry, where)
  assertAdditionalProperties(registry, new Set(['$schema', 'contract_version', 'registry_alias', 'source_repository', 'generated_at', 'signature', 'items']), where)
  if ('$schema' in registry) {
    assert(registry.$schema === REGISTRY_SCHEMA_URL, `Invalid ${where}.$schema: expected "${REGISTRY_SCHEMA_URL}"`)
  }
  assert(registry.contract_version === '1', `Invalid ${where}.contract_version: expected "1"`)
  assert(registry.registry_alias === REGISTRY_ALIAS, `Invalid ${where}.registry_alias: expected "${REGISTRY_ALIAS}"`)
  assertUri(registry.source_repository, `${where}.source_repository`)
  assertDateTime(registry.generated_at, `${where}.generated_at`)
  assertPlainObject(registry.signature, `${where}.signature`)
  assertAdditionalProperties(registry.signature, new Set(['algorithm', 'key_id', 'target', 'signed_digest']), `${where}.signature`)
  assert(registry.signature.algorithm === SIGNATURE_ALGORITHM, `Invalid ${where}.signature.algorithm: expected "${SIGNATURE_ALGORITHM}"`)
  assert(registry.signature.key_id === SIGNATURE_KEY_ID, `Invalid ${where}.signature.key_id: expected "${SIGNATURE_KEY_ID}"`)
  assert(registry.signature.target === SIGNATURE_TARGET, `Invalid ${where}.signature.target: expected "${SIGNATURE_TARGET}"`)
  assertPattern(registry.signature.signed_digest, SHA256_PATTERN, `${where}.signature.signed_digest`)
  assertArray(registry.items, `${where}.items`)
  assert(stableJson(registry) === stableJson(expectedRegistry), `Invalid ${where}: committed registry index drifts from the canonical tree`)
}

async function upsertJson(filePath, expectedValue, mode) {
  const existingValue = await readJsonIfExists(filePath)
  if (mode === 'write') {
    await writeJson(filePath, expectedValue)
    return JSON.parse(stableJson(expectedValue))
  }
  assert(existingValue !== undefined, `Missing required file: ${path.relative(process.cwd(), filePath)}`)
  assert(stableJson(existingValue) === stableJson(expectedValue), `Invalid ${path.relative(process.cwd(), filePath)}: expected canonical generated content`)
  return existingValue
}

async function collectPluginMetadata(pluginRoot, advisoriesByPlugin, mode, enforceAdvisoryConsistency = true) {
  const namespaceEntries = await listEntries(pluginRoot)
  const nonDirectoryEntries = namespaceEntries.filter((entry) => !entry.isDirectory())
  assert(nonDirectoryEntries.length === 0, `plugins/ must contain only namespace directories, found: ${nonDirectoryEntries.map((entry) => entry.name).join(', ')}`)

  const pluginMetas = []
  const pluginVersionLookup = new Map()

  for (const namespaceEntry of namespaceEntries) {
    const namespace = namespaceEntry.name
    assertPattern(namespace, NAMESPACE_PATTERN, `plugins/${namespace}`)
    const namespaceDir = path.join(pluginRoot, namespace)
    await ensureDirectory(namespaceDir, `plugins/${namespace}`)

    const pluginEntries = await listEntries(namespaceDir)
    const invalidNamespaceChildren = pluginEntries.filter((entry) => !entry.isDirectory())
    assert(invalidNamespaceChildren.length === 0, `plugins/${namespace} must contain only plugin directories, found: ${invalidNamespaceChildren.map((entry) => entry.name).join(', ')}`)

    for (const pluginEntry of pluginEntries) {
      const pluginName = pluginEntry.name
      assertPattern(pluginName, PLUGIN_NAME_PATTERN, `plugins/${namespace}/${pluginName}`)
      const pluginDir = path.join(namespaceDir, pluginName)
      await ensureDirectory(pluginDir, `plugins/${namespace}/${pluginName}`)

      const pluginDirEntries = await listEntries(pluginDir)
      const pluginDirNames = pluginDirEntries.map((entry) => entry.name)
      const allowedPluginDirEntries = mode === 'write' ? new Set(['plugin.json', 'versions']) : new Set(['plugin.json', 'versions'])
      const unexpectedPluginDirEntries = pluginDirNames.filter((entryName) => !allowedPluginDirEntries.has(entryName))
      assert(unexpectedPluginDirEntries.length === 0, `plugins/${namespace}/${pluginName} must contain only plugin.json and versions/`)
      assert(pluginDirNames.includes('versions'), `Missing required directory: plugins/${namespace}/${pluginName}/versions`)
      if (mode === 'check') {
        assert(pluginDirNames.includes('plugin.json'), `Missing required file: plugins/${namespace}/${pluginName}/plugin.json`)
      }

      const versionsDir = path.join(pluginDir, 'versions')
      await ensureDirectory(versionsDir, `plugins/${namespace}/${pluginName}/versions`)
      const versionEntries = await listEntries(versionsDir)
      const invalidVersionEntries = versionEntries.filter((entry) => !entry.isDirectory() || !SEMVER_PATTERN.test(entry.name))
      assert(
        invalidVersionEntries.length === 0,
        `plugins/${namespace}/${pluginName}/versions must contain only semver directories, found: ${invalidVersionEntries.map((entry) => entry.name).join(', ')}`,
      )
      assert(versionEntries.length > 0, `plugins/${namespace}/${pluginName}/versions must contain at least one version`)

      const pluginId = `${namespace}.${pluginName}`
      const versionRecords = []
      pluginVersionLookup.set(pluginId, new Set(versionEntries.map((entry) => entry.name)))

      for (const versionEntry of versionEntries.sort((left, right) => compareSemver(right.name, left.name))) {
        const version = versionEntry.name
        const versionDir = path.join(versionsDir, version)
        const relativeVersionRoot = path.posix.join('plugins', namespace, pluginName, 'versions', version)

        const versionDirEntries = await listEntries(versionDir)
        const versionNames = new Set(versionDirEntries.map((entry) => entry.name))
        for (const requiredFile of REQUIRED_VERSION_FILES) {
          assert(versionNames.has(requiredFile), `Missing required file: ${relativeVersionRoot}/${requiredFile}`)
        }
        assert(versionNames.has('.plugin'), `Missing required directory: ${relativeVersionRoot}/.plugin`)

        await ensureDirectory(path.join(versionDir, '.plugin'), `${relativeVersionRoot}/.plugin`)
        await ensureRegularFile(path.join(versionDir, '.plugin', 'plugin.json'), `${relativeVersionRoot}/.plugin/plugin.json`)
        await ensureRegularFile(path.join(versionDir, 'README.md'), `${relativeVersionRoot}/README.md`)
        await ensureRegularFile(path.join(versionDir, 'LICENSE'), `${relativeVersionRoot}/LICENSE`)
        await ensureRegularFile(path.join(versionDir, 'AGENTRIG_SOURCE.json'), `${relativeVersionRoot}/AGENTRIG_SOURCE.json`)
        await ensureRegularFile(path.join(versionDir, 'AGENTRIG_LOCK.json'), `${relativeVersionRoot}/AGENTRIG_LOCK.json`)
        await ensureRegularFile(path.join(versionDir, 'AGENTRIG_REVIEW.json'), `${relativeVersionRoot}/AGENTRIG_REVIEW.json`)

        const pluginManifest = await readJson(path.join(versionDir, '.plugin', 'plugin.json'))
        validatePluginManifest(pluginManifest, pluginId, version, `${relativeVersionRoot}/.plugin/plugin.json`)

        const { fileDigests, snapshotDigest } = await computeVersionDigests(versionDir)

        const sourcePath = path.join(versionDir, 'AGENTRIG_SOURCE.json')
        const sourceArtifact = await readJson(sourcePath)
        const expectedSourceArtifact = canonicalizeSourceArtifact(sourceArtifact, snapshotDigest, `${relativeVersionRoot}/AGENTRIG_SOURCE.json`)
        await upsertJson(sourcePath, expectedSourceArtifact, mode)

        const lockPath = path.join(versionDir, 'AGENTRIG_LOCK.json')
        const lockArtifact = await readJson(lockPath)
        const expectedLockArtifact = canonicalizeLockArtifact(lockArtifact, pluginId, version, fileDigests, snapshotDigest, `${relativeVersionRoot}/AGENTRIG_LOCK.json`)
        await upsertJson(lockPath, expectedLockArtifact, mode)

        const reviewArtifact = await readJson(path.join(versionDir, 'AGENTRIG_REVIEW.json'))
        validateReviewArtifact(reviewArtifact, `${relativeVersionRoot}/AGENTRIG_REVIEW.json`)

        const trustTier = reviewArtifact.trust_tier_basis.trust_tier
        const installability = reviewArtifact.trust_tier_basis.installability
        const advisoryIds = advisoriesByPlugin.get(pluginId)?.map((advisory) => advisory.id) ?? []

        versionRecords.push(sortKeys({
          version,
          path: `${relativeVersionRoot}/`,
          manifest: `${relativeVersionRoot}/.plugin/plugin.json`,
          source: `${relativeVersionRoot}/AGENTRIG_SOURCE.json`,
          lock: `${relativeVersionRoot}/AGENTRIG_LOCK.json`,
          review: `${relativeVersionRoot}/AGENTRIG_REVIEW.json`,
          trust_tier: trustTier,
          installability,
          snapshot_digest: snapshotDigest,
          published_at: reviewArtifact.reviewed_at,
        }))

        if (enforceAdvisoryConsistency && trustTier === 'blocked') {
          assert(
            (advisoriesByPlugin.get(pluginId) ?? []).some((advisory) => advisory.blocked),
            `plugins/${namespace}/${pluginName}: blocked plugins must have at least one blocked advisory`,
          )
        }
        if (enforceAdvisoryConsistency && trustTier === 'yanked') {
          assert(
            (advisoriesByPlugin.get(pluginId) ?? []).some((advisory) => advisory.yanked),
            `plugins/${namespace}/${pluginName}: yanked plugins must have at least one yanked advisory`,
          )
        }
      }

      const latestManifest = await readJson(path.join(versionsDir, versionRecords[0].version, '.plugin', 'plugin.json'))
      const pluginMeta = {
        pluginId,
        namespace,
        pluginName,
        name: latestManifest.name,
        description: latestManifest.description,
        keywords: latestManifest.keywords ?? [],
        advisoryIds: advisoriesByPlugin.get(pluginId)?.map((advisory) => advisory.id) ?? [],
        versions: versionRecords,
      }
      pluginMetas.push(pluginMeta)
    }
  }

  pluginMetas.sort((left, right) => left.pluginId.localeCompare(right.pluginId))
  return { pluginMetas, pluginVersionLookup }
}

async function syncRegistry(mode) {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const repoRoot = path.resolve(__dirname, '..')
  const pluginRoot = path.join(repoRoot, 'plugins')
  const advisoriesPath = path.join(repoRoot, 'advisories.json')
  const registryPath = path.join(repoRoot, 'registry.json')

  await ensureDirectory(pluginRoot, 'plugins/')
  await ensureRegularFile(advisoriesPath, 'advisories.json')

  const rootEntries = await listEntries(repoRoot)
  const unexpectedRoots = rootEntries
    .filter((entry) => entry.name !== '.git' && !ROOT_ALLOWED_ENTRIES.has(entry.name))
    .map((entry) => entry.name)
  assert(unexpectedRoots.length === 0, `Unexpected root entries: ${unexpectedRoots.join(', ')}`)
  for (const blockedEntry of BLOCKED_ROOT_ENTRIES) {
    assert(!rootEntries.some((entry) => entry.name === blockedEntry), `Legacy root entry "${blockedEntry}" is forbidden`)
  }

  const advisories = await readJson(advisoriesPath)

  const emptyPluginVersionLookup = new Map()
  const bootstrapPluginMetas = await collectPluginMetadata(pluginRoot, new Map(), mode, false)
  const advisoryItems = validateAdvisoriesDocument(advisories, bootstrapPluginMetas.pluginVersionLookup ?? emptyPluginVersionLookup)
  const advisoriesByPlugin = new Map()
  for (const advisory of advisoryItems) {
    const current = advisoriesByPlugin.get(advisory.plugin) ?? []
    current.push(advisory)
    advisoriesByPlugin.set(advisory.plugin, current)
  }

  const { pluginMetas } = await collectPluginMetadata(pluginRoot, advisoriesByPlugin, mode)

  const normalizedAdvisories = sortKeys({
    $schema: ADVISORIES_SCHEMA_URL,
    generated_at: advisoryItems.reduce((latest, item) => latest == null || item.published_at > latest ? item.published_at : latest, null) ?? '1970-01-01T00:00:00Z',
    items: advisoryItems.slice().sort((left, right) => left.id.localeCompare(right.id)),
  })
  await upsertJson(advisoriesPath, normalizedAdvisories, mode)

  const generatedTimes = [normalizedAdvisories.generated_at]
  const registryItems = []

  for (const pluginMeta of pluginMetas) {
    for (const versionRecord of pluginMeta.versions) {
      generatedTimes.push(versionRecord.published_at)
    }

    const historyPath = path.join(repoRoot, 'plugins', pluginMeta.namespace, pluginMeta.pluginName, 'plugin.json')
    const expectedHistory = generateHistoryDocument(pluginMeta)
    const existingHistory = await upsertJson(historyPath, expectedHistory, mode)
    validateHistoryDocument(existingHistory, pluginMeta, path.posix.join('plugins', pluginMeta.namespace, pluginMeta.pluginName, 'plugin.json'))

    registryItems.push(sortKeys({
      plugin: pluginMeta.pluginId,
      name: pluginMeta.name,
      description: pluginMeta.description,
      latest_version: pluginMeta.versions[0].version,
      history: path.posix.join('plugins', pluginMeta.namespace, pluginMeta.pluginName, 'plugin.json'),
      active_version: makeActiveVersionRecord(pluginMeta.versions[0]),
      trust_tier: pluginMeta.versions[0].trust_tier,
      installability: pluginMeta.versions[0].installability,
      keywords: maybeArray(pluginMeta.keywords),
      advisories: maybeArray(pluginMeta.advisoryIds),
    }))
  }

  registryItems.sort((left, right) => left.plugin.localeCompare(right.plugin))
  const generatedAt = generatedTimes.filter(Boolean).sort().at(-1) ?? '1970-01-01T00:00:00Z'
  const expectedRegistry = generateRegistryDocument(registryItems, generatedAt)
  const existingRegistry = await upsertJson(registryPath, expectedRegistry, mode)
  validateRegistryDocument(existingRegistry, expectedRegistry)

  console.log(`${mode === 'write' ? 'Synced' : 'Validated'} ${pluginMetas.length} plugin(s)`)
}

const mode = process.argv.includes('--write') ? 'write' : 'check'

syncRegistry(mode).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
