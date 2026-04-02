#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?$/
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/
const URI_PATTERN = /^https?:\/\/.+/
const REGISTRY_SCHEMA_URL = 'https://agentrig.ai/schema/registry.v1.json'
const PLUGIN_SCHEMA_URL = 'https://agentrig.ai/schema/plugin.v1.json'
const PLUGIN_HISTORY_SCHEMA_URL = 'https://agentrig.ai/schema/plugin-history.v1.json'

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf-8'))
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

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

function isDeliveryArtifact(name) {
  const lower = name.toLowerCase()
  if (BLOCKED_DELIVERY_FILENAMES.has(lower)) return true
  if (BLOCKED_DELIVERY_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true
  if (BLOCKED_DELIVERY_NAME_PATTERNS.some((pat) => pat.test(name))) return true
  return false
}

async function findDeliveryArtifacts(dir) {
  const found = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      found.push(full)
      continue
    }
    if (entry.isDirectory()) {
      if (isDeliveryArtifact(entry.name)) {
        found.push(full)
      } else {
        found.push(...(await findDeliveryArtifacts(full)))
      }
    } else if (entry.isFile() && isDeliveryArtifact(entry.name)) {
      found.push(full)
    }
  }
  return found
}

async function assertNoDeliveryArtifacts(versionDir) {
  const artifacts = await findDeliveryArtifacts(versionDir)
  if (artifacts.length) {
    throw new Error(
      `Invalid ${versionDir}: source plugin must not contain delivery artifacts (found: ${artifacts.map((f) => path.relative(versionDir, f)).join(', ')})`
    )
  }
}

function parseSemver(version) {
  const match = version.match(SEMVER_PATTERN)
  if (!match) {
    throw new Error(`Invalid semver: ${version}`)
  }
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
  if (leftNumeric && rightNumeric) {
    return Number.parseInt(left, 10) - Number.parseInt(right, 10)
  }
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

function stableJson(value) {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortKeys(child)]),
    )
  }
  return value
}

const PLUGIN_MANIFEST_ALLOWED_KEYS = new Set([
  '$schema', 'kind', 'id', 'name', 'description', 'version',
  'author', 'license', 'keywords', 'pluginDependencies', 'configSchema', 'x-agentrig',
])

function assertPluginManifest(manifest, pluginDir) {
  const where = `.plugin/plugin.json in ${pluginDir}`
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Invalid ${where}: not an object`)
  }
  if (typeof manifest.$schema === 'string' && manifest.$schema !== PLUGIN_SCHEMA_URL) {
    throw new Error(`Invalid ${where}: $schema must be "${PLUGIN_SCHEMA_URL}"`)
  }
  for (const key of ['id', 'name', 'description', 'version']) {
    if (typeof manifest[key] !== 'string' || !String(manifest[key]).trim()) {
      throw new Error(`Invalid ${where}: missing ${key}`)
    }
  }
  if (!PLUGIN_ID_PATTERN.test(manifest.id)) {
    throw new Error(`Invalid ${where}: id "${manifest.id}" must be lowercase letters, numbers, and hyphens only`)
  }
  if (manifest.kind !== 'agentrig:plugin') {
    throw new Error(`Invalid ${where}: kind must be "agentrig:plugin"`)
  }
  if ('license' in manifest && typeof manifest.license !== 'string') {
    throw new Error(`Invalid ${where}: license must be omitted or a string`)
  }
  if ('author' in manifest && typeof manifest.author !== 'string') {
    throw new Error(`Invalid ${where}: author must be omitted or a string`)
  }
  if (typeof manifest.configSchema !== 'object' || manifest.configSchema == null || Array.isArray(manifest.configSchema)) {
    throw new Error(`Invalid ${where}: configSchema must be a non-null, non-array object`)
  }
  if ('keywords' in manifest) {
    if (!Array.isArray(manifest.keywords)) {
      throw new Error(`Invalid ${where}: keywords must be an array`)
    }
    for (const kw of manifest.keywords) {
      if (typeof kw !== 'string') {
        throw new Error(`Invalid ${where}: keywords items must be strings`)
      }
    }
  }
  if ('pluginDependencies' in manifest) {
    if (!Array.isArray(manifest.pluginDependencies)) {
      throw new Error(`Invalid ${where}: pluginDependencies must be an array`)
    }
    for (const dep of manifest.pluginDependencies) {
      if (typeof dep !== 'string') {
        throw new Error(`Invalid ${where}: pluginDependencies items must be strings`)
      }
    }
  }
  if ('x-agentrig' in manifest) {
    if (
      manifest['x-agentrig'] == null ||
      typeof manifest['x-agentrig'] !== 'object' ||
      Array.isArray(manifest['x-agentrig'])
    ) {
      throw new Error(`Invalid ${where}: x-agentrig must be a plain object when present`)
    }
  }
  for (const key of Object.keys(manifest)) {
    if (!PLUGIN_MANIFEST_ALLOWED_KEYS.has(key)) {
      throw new Error(`Invalid ${where}: unexpected field "${key}" — only canonical source fields are allowed`)
    }
  }
}

function assertHistoryManifest(manifest, pluginId, versions, latestManifest) {
  const where = `manifests/${pluginId}.json`
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Invalid ${where}: not an object`)
  }
  if (typeof manifest.$schema === 'string' && manifest.$schema !== PLUGIN_HISTORY_SCHEMA_URL) {
    throw new Error(`Invalid ${where}: $schema must be "${PLUGIN_HISTORY_SCHEMA_URL}"`)
  }
  if (manifest.id !== pluginId) {
    throw new Error(`Invalid ${where}: id must be "${pluginId}"`)
  }
  if (manifest.name !== latestManifest.name) {
    throw new Error(`Invalid ${where}: name must match latest plugin manifest`)
  }
  if (manifest.description !== latestManifest.description) {
    throw new Error(`Invalid ${where}: description must match latest plugin manifest`)
  }
  if (manifest.latest !== latestManifest.version) {
    throw new Error(`Invalid ${where}: latest must be "${latestManifest.version}"`)
  }
  if (!Array.isArray(manifest.versions) || !manifest.versions.length) {
    throw new Error(`Invalid ${where}: versions must be a non-empty array`)
  }
  const expectedVersions = [...versions].sort((left, right) => compareSemver(left, right))
  if (stableJson(manifest.versions.map(String)) !== stableJson(expectedVersions)) {
    throw new Error(`Invalid ${where}: versions must match plugin directories`)
  }
  const expectedKeywords = Array.isArray(latestManifest.keywords) ? latestManifest.keywords : []
  if ('keywords' in manifest) {
    if (!Array.isArray(manifest.keywords)) {
      throw new Error(`Invalid ${where}: keywords must be an array`)
    }
    for (const kw of manifest.keywords) {
      if (typeof kw !== 'string') {
        throw new Error(`Invalid ${where}: keywords items must be strings, got ${typeof kw}`)
      }
    }
  }
  const actualKeywords = Array.isArray(manifest.keywords) ? manifest.keywords : []
  if (stableJson(actualKeywords) !== stableJson(expectedKeywords)) {
    throw new Error(`Invalid ${where}: keywords must match latest plugin manifest`)
  }
  if (manifest.trustTier !== 'official') {
    throw new Error(`Invalid ${where}: trustTier must be "official"`)
  }
  if (!manifest.paths || typeof manifest.paths !== 'object') {
    throw new Error(`Invalid ${where}: paths are required`)
  }
  if (manifest.paths.plugin !== `plugins/${pluginId}/${latestManifest.version}`) {
    throw new Error(`Invalid ${where}: paths.plugin must point to the latest plugin version`)
  }
  if (manifest.paths.manifest !== `manifests/${pluginId}.json`) {
    throw new Error(`Invalid ${where}: paths.manifest must point back to the history manifest`)
  }
  const HISTORY_PATHS_ALLOWED_KEYS = new Set(['plugin', 'manifest'])
  for (const key of Object.keys(manifest.paths)) {
    if (!HISTORY_PATHS_ALLOWED_KEYS.has(key)) {
      throw new Error(`Invalid ${where}: unexpected paths field "${key}" — only plugin and manifest are allowed`)
    }
  }
  const HISTORY_MANIFEST_ALLOWED_KEYS = new Set([
    '$schema', 'id', 'name', 'description', 'latest', 'versions',
    'keywords', 'trustTier', 'paths',
  ])
  for (const key of Object.keys(manifest)) {
    if (!HISTORY_MANIFEST_ALLOWED_KEYS.has(key)) {
      throw new Error(`Invalid ${where}: unexpected field "${key}" — only canonical history manifest fields are allowed`)
    }
  }
}

async function main() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const repoRoot = path.resolve(__dirname, '..')
  const pluginRoot = path.join(repoRoot, 'plugins')
  const manifestRoot = path.join(repoRoot, 'manifests')
  const registryIndexPath = path.join(repoRoot, 'registry.json')

  for (const [label, canonicalPath] of [['plugins', pluginRoot], ['manifests', manifestRoot]]) {
    const stat = await fs.lstat(canonicalPath)
    if (stat.isSymbolicLink()) {
      throw new Error(`${label}/ must be a real directory, not a symlink`)
    }
    if (!stat.isDirectory()) {
      throw new Error(`${label}/ must be a directory`)
    }
  }
  const registryStat = await fs.lstat(registryIndexPath)
  if (registryStat.isSymbolicLink()) {
    throw new Error('registry.json must be a regular file, not a symlink')
  }
  if (!registryStat.isFile()) {
    throw new Error('registry.json must be a regular file')
  }

  const REPO_ROOT_ALLOWED = new Set([
    '.git', '.github', 'manifests', 'plugins', 'scripts',
    'registry.json', 'README.md', 'LICENSE', 'NOTICE', 'CODEOWNERS',
  ])
  const rootEntries = await fs.readdir(repoRoot, { withFileTypes: true })
  const unexpectedRoot = rootEntries
    .filter((entry) => !REPO_ROOT_ALLOWED.has(entry.name))
    .map((entry) => entry.name)
  if (unexpectedRoot.length) {
    throw new Error(`Unexpected root entries (allowlist violation): ${unexpectedRoot.join(', ')}`)
  }

  const registryIndex = await readJson(registryIndexPath)
  const REGISTRY_INDEX_ALLOWED_KEYS = new Set(['$schema', 'name', 'homepage', 'items'])
  for (const key of Object.keys(registryIndex)) {
    if (!REGISTRY_INDEX_ALLOWED_KEYS.has(key)) {
      throw new Error(`Invalid registry.json: unexpected field "${key}" — only $schema, name, homepage, items are allowed`)
    }
  }
  if (typeof registryIndex.$schema === 'string' && registryIndex.$schema !== REGISTRY_SCHEMA_URL) {
    throw new Error(`Invalid registry.json: $schema must be "${REGISTRY_SCHEMA_URL}"`)
  }
  if (typeof registryIndex.name !== 'string' || !registryIndex.name.trim()) {
    throw new Error('Invalid registry.json: name is required')
  }
  if (typeof registryIndex.homepage !== 'string' || !registryIndex.homepage.trim()) {
    throw new Error('Invalid registry.json: homepage is required')
  }
  if (!URI_PATTERN.test(registryIndex.homepage)) {
    throw new Error(`Invalid registry.json: homepage must be an http/https URI, got "${registryIndex.homepage}"`)
  }
  if (!Array.isArray(registryIndex.items)) {
    throw new Error('Invalid registry.json: items must be an array')
  }

  const pluginEntries = await fs.readdir(pluginRoot, { withFileTypes: true })
  const unexpectedPluginRootEntries = pluginEntries.filter((entry) => !entry.isDirectory())
  if (unexpectedPluginRootEntries.length) {
    throw new Error(
      `plugins/ must contain only plugin id directories, found: ${unexpectedPluginRootEntries.map((entry) => entry.name).join(', ')}`
    )
  }
  const pluginDirs = pluginEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginRoot, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)))
  const pluginIds = pluginDirs.map((pluginDir) => path.basename(pluginDir))
  const manifestEntries = await fs.readdir(manifestRoot, { withFileTypes: true })
  const unexpectedManifestEntries = manifestEntries.filter(
    (entry) => !entry.isFile() || !entry.name.endsWith('.json')
  )
  if (unexpectedManifestEntries.length) {
    throw new Error(
      `manifests/ must contain only .json files, found: ${unexpectedManifestEntries.map((e) => e.name).join(', ')}`
    )
  }
  const manifestIds = manifestEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/, ''))
    .sort((left, right) => left.localeCompare(right))
  if (stableJson(manifestIds) !== stableJson([...pluginIds].sort((left, right) => left.localeCompare(right)))) {
    throw new Error('manifests directory does not match plugin directory ids')
  }

  const expectedItems = []

  for (const pluginDir of pluginDirs) {
    const pluginId = path.basename(pluginDir)
    const versionDirs = (await fs.readdir(pluginDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => compareSemver(right, left))

    if (!versionDirs.length) {
      throw new Error(`Plugin directory ${pluginId} has no versioned subdirectories — remove the directory or add a versioned plugin payload`)
    }

    const latestVersion = versionDirs[0]
    const latestDir = path.join(pluginDir, latestVersion)
    const latestManifestPath = path.join(latestDir, '.plugin', 'plugin.json')
    const latestManifest = await readJson(latestManifestPath)
    assertPluginManifest(latestManifest, latestDir)

    if (latestManifest.id !== pluginId) {
      throw new Error(`Plugin id mismatch for ${pluginId}: expected ${pluginId}, got ${latestManifest.id}`)
    }
    if (latestManifest.version !== latestVersion) {
      throw new Error(
        `Plugin version mismatch for ${pluginId}: expected ${latestVersion}, got ${latestManifest.version}`,
      )
    }

    const pluginDirEntries = await fs.readdir(pluginDir, { withFileTypes: true })
    for (const pluginDirEntry of pluginDirEntries) {
      if (!pluginDirEntry.isDirectory() || !SEMVER_PATTERN.test(pluginDirEntry.name)) {
        throw new Error(
          `Plugin directory "${pluginId}" must contain only versioned subdirectories, found: "${pluginDirEntry.name}"`
        )
      }
    }

    for (const version of versionDirs) {
      parseSemver(version)
      const versionDir = path.join(pluginDir, version)
      await assertNoDeliveryArtifacts(versionDir)
      const manifestPath = path.join(versionDir, '.plugin', 'plugin.json')
      const manifest = await readJson(manifestPath)
      assertPluginManifest(manifest, versionDir)
      if (manifest.id !== pluginId || manifest.version !== version) {
        throw new Error(`Plugin metadata must match directory path for ${pluginId}/${version}`)
      }
    }

    const historyManifestPath = path.join(manifestRoot, `${pluginId}.json`)
    const historyManifest = await readJson(historyManifestPath)
    assertHistoryManifest(historyManifest, pluginId, versionDirs, latestManifest)

    expectedItems.push({
      id: latestManifest.id,
      name: latestManifest.name,
      description: latestManifest.description,
      version: latestManifest.version,
      keywords: latestManifest.keywords ?? undefined,
      manifest: `manifests/${pluginId}.json`,
    })
  }

  if (stableJson(registryIndex.items) !== stableJson(expectedItems)) {
    throw new Error('registry.json items do not match the canonical source registry')
  }

  console.log(`Validated ${expectedItems.length} plugin(s)`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
