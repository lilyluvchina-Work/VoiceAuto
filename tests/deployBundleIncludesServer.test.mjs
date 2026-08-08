import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const psScript = readFileSync(new URL('../deploy/scripts/build_deploy_bundle.ps1', import.meta.url), 'utf8');
const shScript = readFileSync(new URL('../deploy/scripts/build_deploy_bundle.sh', import.meta.url), 'utf8');

assert.match(psScript, /Copying backend server/);
assert.match(psScript, /Join-Path \$bundleDir "server"/);
assert.match(psScript, /Join-Path \$projectRoot "server"/);

assert.match(shScript, /Copying backend server/);
assert.match(shScript, /\$BUNDLE_DIR\/server/);
assert.match(shScript, /\$PROJECT_ROOT\/server/);
