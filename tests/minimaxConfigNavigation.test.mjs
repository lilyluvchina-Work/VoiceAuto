import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const configCenterSource = readFileSync(new URL('../src/components/ConfigCenter.jsx', import.meta.url), 'utf8');
const summaryReportSource = readFileSync(new URL('../src/components/SummaryReport.jsx', import.meta.url), 'utf8');

assert.match(summaryReportSource, /开始评测/);
assert.doesNotMatch(summaryReportSource, /配置 MiniMax/);
assert.match(appSource, /voiceauto:open-config-type/);
assert.match(appSource, /setActiveMode\(MODES\.config\)/);
assert.match(configCenterSource, /voiceauto:open-config-type/);
assert.match(configCenterSource, /setActiveType\(requestedType\)/);
