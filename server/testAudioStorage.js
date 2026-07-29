import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const MIME_BY_FORMAT = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
};

function getStorageRoot() {
  return resolve(process.env.TEST_AUDIO_STORAGE_DIR || join(process.cwd(), 'storage', 'test-audios'));
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function normalizeFormat(value, contentType = '') {
  const format = String(value || '').toLowerCase().replace(/^\./, '');
  if (MIME_BY_FORMAT[format]) return format;
  if (/wav/i.test(contentType)) return 'wav';
  if (/ogg/i.test(contentType)) return 'ogg';
  if (/mp4|m4a/i.test(contentType)) return 'm4a';
  return 'mp3';
}

function resolveInsideStorage(filePath) {
  const root = getStorageRoot();
  const resolved = resolve(filePath);
  if (resolved !== root && !resolved.startsWith(`${root}\\`) && !resolved.startsWith(`${root}/`)) {
    const error = new Error('音频文件路径不在允许的存储目录内');
    error.status = 403;
    throw error;
  }
  return resolved;
}

export function getAudioMimeType(formatOrPath) {
  const ext = extname(String(formatOrPath || '')).replace('.', '').toLowerCase();
  const key = ext || String(formatOrPath || '').toLowerCase();
  return MIME_BY_FORMAT[key] || 'audio/mpeg';
}

export async function saveTestAudioFile(audioId, audioBuffer, options = {}) {
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    const error = new Error('音频文件为空，无法保存');
    error.status = 502;
    throw error;
  }

  const now = new Date();
  const format = normalizeFormat(options.audioFormat, options.contentType);
  const relativeDir = join(
    String(now.getFullYear()),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  );
  const dir = join(getStorageRoot(), relativeDir);
  await mkdir(dir, { recursive: true });

  const fileName = `${audioId}_${Date.now()}.${format}`;
  const filePath = join(dir, fileName);
  await writeFile(filePath, audioBuffer);

  return {
    filePath,
    fileSize: audioBuffer.length,
    fileHash: createHash('sha256').update(audioBuffer).digest('hex'),
    audioFormat: format,
    fileUrl: `/api/test-audios/${encodeURIComponent(audioId)}/play`,
  };
}

export async function getReadableTestAudioFile(filePath) {
  const safePath = resolveInsideStorage(filePath);
  const info = await stat(safePath);
  if (!info.isFile()) {
    const error = new Error('音频文件不存在');
    error.status = 404;
    throw error;
  }
  return {
    stream: createReadStream(safePath),
    size: info.size,
    contentType: getAudioMimeType(safePath),
  };
}

export async function deleteTestAudioFile(filePath) {
  if (!filePath) return;
  const safePath = resolveInsideStorage(filePath);
  await unlink(safePath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}
