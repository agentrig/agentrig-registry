#!/usr/bin/env node

import assert from 'node:assert/strict'
import {
  assertProductionArtifactAllowed,
  isProductionTestArtifactId,
  pluginManifestRelativePath,
  validatePluginManifest,
} from './validate-registry.mjs'

assert.equal(isProductionTestArtifactId('test-acme.workflow'), true)
assert.equal(isProductionTestArtifactId('qa-acme.workflow'), true)
assert.equal(isProductionTestArtifactId('acme.test-workflow'), true)
assert.equal(isProductionTestArtifactId('regenrek.test-submission'), true)
assert.equal(isProductionTestArtifactId('acme.workflow'), false)
assert.equal(isProductionTestArtifactId('community.typescript'), false)

process.env.REGISTRY_ENVIRONMENT = 'production'
assert.throws(
  () => assertProductionArtifactAllowed('regenrek.test-submission', 'fixture'),
  /production registry rejects test\/QA artifact/,
)
assert.doesNotThrow(() => assertProductionArtifactAllowed('community.typescript', 'fixture'))

process.env.REGISTRY_ENVIRONMENT = 'staging'
assert.doesNotThrow(() => assertProductionArtifactAllowed('regenrek.test-submission', 'fixture'))

assert.equal(pluginManifestRelativePath('community.demo', '1.0.0'), 'plugin.json')
assert.equal(pluginManifestRelativePath('agentrig.core', '0.1.0'), '.plugin/plugin.json')
assert.equal(pluginManifestRelativePath('agentrig.core', '0.2.0'), 'plugin.json')

const agentPluginManifest = {
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
  name: 'community.typescript',
  version: '1.0.0',
  extensions: { 'ai.agentrig': { displayName: 'TypeScript Tools' } },
}
assert.doesNotThrow(() => validatePluginManifest(
  agentPluginManifest,
  'community.typescript',
  '1.0.0',
  'fixture/plugin.json',
))
assert.throws(
  () => validatePluginManifest(
    { ...agentPluginManifest, $schema: 'https://agentrig.ai/schema/plugin.v1.json' },
    'community.typescript',
    '1.0.0',
    'fixture/plugin.json',
  ),
  /expected "https:\/\/agent-plugins\.org\/schemas\/1\.0\.0\/plugin\.schema\.json"/,
)

console.log('Validated production registry namespace policy')
