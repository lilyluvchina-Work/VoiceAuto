import { createPool } from '../server/db.js';
import { saveAppConfig } from '../server/configRepository.js';
import { SENSITIVE_DEFAULT_CONFIG } from '../src/config/sensitiveDefaults.js';

const pool = createPool();

try {
  await saveAppConfig(pool, 'dingtalk', SENSITIVE_DEFAULT_CONFIG.dingTalk, 'seed-default-configs');
  await saveAppConfig(pool, 'tapd', SENSITIVE_DEFAULT_CONFIG.tapd, 'seed-default-configs');
  await saveAppConfig(pool, 'langfuse', SENSITIVE_DEFAULT_CONFIG.langfuse, 'seed-default-configs');
  console.log('Default configs saved to database');
} finally {
  await pool.end();
}
