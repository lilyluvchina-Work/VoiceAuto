const VALID_CONFIG_TYPES = new Set([
  'langfuse',
  'tapd',
  'dingtalk',
  'doubaoTts',
  'minimax',
  'server',
]);
const initializedPools = new WeakSet();

async function ensureAppConfigTable(pool) {
  if (initializedPools.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_config (
      config_type TEXT PRIMARY KEY,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by TEXT NOT NULL DEFAULT 'system',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1
    )
  `);
  initializedPools.add(pool);
}

function assertConfigType(configType) {
  if (!VALID_CONFIG_TYPES.has(configType)) {
    const error = new Error('配置类型不存在');
    error.status = 404;
    throw error;
  }
}

function toConfig(row) {
  if (!row) return null;
  return {
    type: row.config_type,
    configured: true,
    version: Number(row.version || 1),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
  };
}

export async function readAppConfig(pool, configType) {
  assertConfigType(configType);
  await ensureAppConfigTable(pool);
  const result = await pool.query(
    `SELECT config_type, payload, updated_by, created_at, updated_at, version
       FROM app_config
      WHERE config_type = $1
      LIMIT 1`,
    [configType]
  );
  return toConfig(result.rows[0]);
}

export async function listAppConfigs(pool) {
  await ensureAppConfigTable(pool);
  const result = await pool.query(
    `SELECT config_type, payload, updated_by, created_at, updated_at, version
       FROM app_config
      ORDER BY config_type ASC`
  );
  return result.rows.map(toConfig);
}

export async function saveAppConfig(pool, configType, payload, actor) {
  assertConfigType(configType);
  await ensureAppConfigTable(pool);
  const result = await pool.query(
    `INSERT INTO app_config (config_type, payload, updated_by, created_at, updated_at, version)
     VALUES ($1, $2, $3, NOW(), NOW(), 1)
     ON CONFLICT (config_type)
     DO UPDATE SET
       payload = EXCLUDED.payload,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW(),
       version = app_config.version + 1
     RETURNING config_type, payload, updated_by, created_at, updated_at, version`,
    [configType, payload || {}, actor || 'system']
  );
  return toConfig(result.rows[0]);
}
