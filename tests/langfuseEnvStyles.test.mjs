import assert from 'node:assert/strict';
import { DEFAULT_LANGFUSE_ENV_STYLE, getLangfuseEnvStyle } from '../src/components/langfuseEnvStyles.js';

assert.notEqual(getLangfuseEnvStyle('UAT'), DEFAULT_LANGFUSE_ENV_STYLE);
assert.notEqual(getLangfuseEnvStyle('TEST_LOCAL'), DEFAULT_LANGFUSE_ENV_STYLE);
assert.equal(getLangfuseEnvStyle('CUSTOM_ENV'), DEFAULT_LANGFUSE_ENV_STYLE);
