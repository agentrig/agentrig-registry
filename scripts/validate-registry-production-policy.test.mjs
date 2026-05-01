#!/usr/bin/env node

import assert from 'node:assert/strict'
import {
  assertProductionArtifactAllowed,
  isProductionTestArtifactId,
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

console.log('Validated production registry namespace policy')
