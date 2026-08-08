const initializedPools = new WeakSet();

async function ensureTestAudioTables(pool) {
  if (initializedPools.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS test_audio (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      text_content TEXT NOT NULL,
      voice_code VARCHAR(64),
      language VARCHAR(32),
      speed NUMERIC(4, 2),
      pitch NUMERIC(4, 2),
      volume NUMERIC(4, 2),
      audio_format VARCHAR(16),
      sample_rate INTEGER,
      duration_ms INTEGER,
      file_url VARCHAR(512),
      file_path VARCHAR(512),
      file_size BIGINT,
      file_hash VARCHAR(128),
      status VARCHAR(32) NOT NULL,
      error_message TEXT,
      generation_params JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS test_audio_generation_record (
      id BIGSERIAL PRIMARY KEY,
      test_audio_id BIGINT NOT NULL REFERENCES test_audio(id),
      old_file_path VARCHAR(512),
      new_file_path VARCHAR(512),
      params JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(32) NOT NULL,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  initializedPools.add(pool);
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toAudio(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name,
    textContent: row.text_content,
    voiceCode: row.voice_code,
    language: row.language,
    speed: toNumberOrNull(row.speed),
    pitch: toNumberOrNull(row.pitch),
    volume: toNumberOrNull(row.volume),
    audioFormat: row.audio_format,
    sampleRate: toNumberOrNull(row.sample_rate),
    durationMs: toNumberOrNull(row.duration_ms),
    fileUrl: row.file_url,
    filePath: row.file_path,
    fileSize: toNumberOrNull(row.file_size),
    fileHash: row.file_hash,
    status: row.status,
    errorMessage: row.error_message,
    generationParams: row.generation_params && typeof row.generation_params === 'object'
      ? row.generation_params
      : {},
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

const AUDIO_COLUMNS = `
  id, name, text_content, voice_code, language, speed, pitch, volume,
  audio_format, sample_rate, duration_ms, file_url, file_path, file_size,
  file_hash, status, error_message, generation_params, created_by,
  created_at, updated_at, deleted_at
`;

export async function createTestAudio(pool, input, actorId) {
  await ensureTestAudioTables(pool);
  const result = await pool.query(
    `INSERT INTO test_audio (
       name, text_content, voice_code, language, speed, pitch, volume,
       audio_format, sample_rate, status, generation_params, created_by,
       created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'generating', $10, $11, NOW(), NOW())
     RETURNING ${AUDIO_COLUMNS}`,
    [
      input.name,
      input.textContent,
      input.voiceCode,
      input.language,
      input.speed,
      input.pitch,
      input.volume,
      input.audioFormat,
      input.sampleRate,
      input.generationParams || {},
      actorId || null,
    ]
  );
  return toAudio(result.rows[0]);
}

export async function listTestAudios(pool) {
  await ensureTestAudioTables(pool);
  const result = await pool.query(
    `SELECT ${AUDIO_COLUMNS}
       FROM test_audio
      WHERE deleted_at IS NULL AND status <> 'deleted'
      ORDER BY created_at DESC, id DESC`
  );
  return result.rows.map(toAudio);
}

export async function getTestAudio(pool, id, options = {}) {
  await ensureTestAudioTables(pool);
  const result = await pool.query(
    `SELECT ${AUDIO_COLUMNS}
       FROM test_audio
      WHERE id = $1 ${options.includeDeleted ? '' : "AND deleted_at IS NULL AND status <> 'deleted'"}
      LIMIT 1`,
    [id]
  );
  return toAudio(result.rows[0]);
}

export async function updateTestAudioSuccess(pool, id, patch) {
  await ensureTestAudioTables(pool);
  const result = await pool.query(
    `UPDATE test_audio
        SET name = $2,
            text_content = $3,
            voice_code = $4,
            language = $5,
            speed = $6,
            pitch = $7,
            volume = $8,
            audio_format = $9,
            sample_rate = $10,
            duration_ms = $11,
            file_url = $12,
            file_path = $13,
            file_size = $14,
            file_hash = $15,
            status = 'success',
            error_message = NULL,
            generation_params = $16,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${AUDIO_COLUMNS}`,
    [
      id,
      patch.name,
      patch.textContent,
      patch.voiceCode,
      patch.language,
      patch.speed,
      patch.pitch,
      patch.volume,
      patch.audioFormat,
      patch.sampleRate,
      patch.durationMs,
      patch.fileUrl,
      patch.filePath,
      patch.fileSize,
      patch.fileHash,
      patch.generationParams || {},
    ]
  );
  return toAudio(result.rows[0]);
}

export async function markTestAudioFailed(pool, id, message, options = {}) {
  await ensureTestAudioTables(pool);
  const result = await pool.query(
    `UPDATE test_audio
        SET status = $2,
            error_message = $3,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${AUDIO_COLUMNS}`,
    [id, options.keepSuccess ? 'success' : 'failed', message]
  );
  return toAudio(result.rows[0]);
}

export async function markTestAudioGenerating(pool, id) {
  await ensureTestAudioTables(pool);
  const result = await pool.query(
    `UPDATE test_audio
        SET status = 'generating',
            error_message = NULL,
            updated_at = NOW()
      WHERE id = $1 AND status <> 'generating'
      RETURNING ${AUDIO_COLUMNS}`,
    [id]
  );
  return toAudio(result.rows[0]);
}

export async function softDeleteTestAudio(pool, id) {
  await ensureTestAudioTables(pool);
  const result = await pool.query(
    `UPDATE test_audio
        SET status = 'deleted',
            deleted_at = COALESCE(deleted_at, NOW()),
            updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL AND status <> 'deleted'
      RETURNING ${AUDIO_COLUMNS}`,
    [id]
  );
  return toAudio(result.rows[0]);
}

export async function createGenerationRecord(pool, input) {
  await ensureTestAudioTables(pool);
  await pool.query(
    `INSERT INTO test_audio_generation_record (
       test_audio_id, old_file_path, new_file_path, params, status, error_message, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      input.testAudioId,
      input.oldFilePath || null,
      input.newFilePath || null,
      input.params || {},
      input.status,
      input.errorMessage || null,
    ]
  );
}
