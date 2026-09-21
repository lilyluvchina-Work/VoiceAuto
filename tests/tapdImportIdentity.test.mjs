import assert from 'node:assert/strict';
import { getTapdImportIdentity } from '../src/modules/tapd/utils/tapdParser.js';

const original = { source: 'tapd', workspaceId: 'w', tapdTestPlanId: 'p', tapdCaseId: '1', humanIndex: 1, text: '你好' };
assert.notEqual(getTapdImportIdentity(original), getTapdImportIdentity({ ...original, tapdCaseId: '2' }));
assert.notEqual(getTapdImportIdentity(original), getTapdImportIdentity({ ...original, tapdTestPlanId: 'p2' }));
assert.notEqual(getTapdImportIdentity(original), getTapdImportIdentity({ ...original, workspaceId: 'w2' }));
assert.notEqual(getTapdImportIdentity(original), getTapdImportIdentity({ ...original, humanIndex: 2 }));
assert.equal(getTapdImportIdentity(original), getTapdImportIdentity({ ...original, id: 'new-local-id' }));
assert.equal(getTapdImportIdentity({ source: 'text', text: '你好' }), null);
