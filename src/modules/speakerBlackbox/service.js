import { restartBridge } from '../../services/bridgeService.js';
const DEFAULT_BRIDGE = 'http://127.0.0.1:17321';
export async function request(bridge, body, signal) {
  const timeout = new AbortController();
  const abort = () => timeout.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, body.action === 'reset' ? 45000 : 20000);
  try {
    const response = await fetch(`${(bridge || DEFAULT_BRIDGE).replace(/\/+$/, '')}/api/audio/blackbox`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: timeout.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 404) throw new Error('请更新并重启连接音箱电脑上的本机音频桥接：npm run adb:bridge，当前桥接版本不支持音箱黑盒测试');
      throw new Error(data.message || '本机黑盒测试操作失败');
    }
    return data;
  } catch (error) {
    if (error instanceof TypeError) throw new Error('无法连接本机音频桥接，请在连接音箱的电脑执行 npm run adb:bridge');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function resetRun(bridge, id, { onProgress, requestImpl = request, restartImpl = restartBridge,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, timeoutMs = 35000 } = {}) {
  try {
    const result = await requestImpl(bridge, { action: 'reset', id });
    if (result.reset !== true) throw new Error('未知黑盒测试操作');
    return result;
  } catch (error) {
    if (!['任务执行中不能修改音频或配置', '未知黑盒测试操作'].includes(error.message)) throw error;
  }
  // An older running process can reject reset even when its files have been updated.
  // Finish its task before asking the existing safe restart endpoint to reload code.
  onProgress?.('正在结束旧版桥接任务，等待设备释放…');
  await requestImpl(bridge, { action: 'stop', id });
  const deadline = now() + timeoutMs;
  while (true) {
    const status = await requestImpl(bridge, { action: 'status', id });
    const active = ['running', 'calibrating', 'pausing', 'paused', 'resuming', 'stopping'].includes(status.status);
    const notifying = Object.values(status.notifications || {}).some(item => item.status === 'pending');
    if (!active && !notifying) break;
    if (now() >= deadline) throw new Error('等待任务结束超时，测试数据尚未清空，请稍后重试');
    await sleep(400);
  }
  await restartImpl(bridge, { onStatus: onProgress });
  const result = await requestImpl(bridge, { action: 'reset', id });
  if (result.reset !== true) throw new Error('当前桥接仍不支持重置，请更新本机桥接后重试');
  return result;
}

// Normalize browser-supported audio files before transfer. Output selection and
// timed playback happen exclusively in the native worker, never in this context.
export async function encodeWav(file) {
  if (file.size > 40 * 1024 * 1024) throw new Error(`${file.name} 超过 40 MiB`);
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw new Error('浏览器不支持音频解码，请更换浏览器');
  const context = new Context();
  let decoded;
  try { decoded = await context.decodeAudioData(await file.arrayBuffer()); }
  catch { throw new Error(`无法解码音频：${file.name}`); }
  finally { await context.close(); }
  const count = Math.floor(decoded.duration * 16000);
  if (!count || count * 2 + 44 > 40 * 1024 * 1024) throw new Error('音频为空或解码后超过 40 MiB');
  const offline = new OfflineAudioContext(1, count, 16000);
  const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
  const rendered = await offline.startRendering(), samples = rendered.getChannelData(0);
  const bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer);
  const text = (offset, value) => { [...value].forEach((c, n) => view.setUint8(offset + n, c.charCodeAt(0))); };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 2, true);
  for (let n = 0; n < count; n++) view.setInt16(44 + n * 2, Math.round(Math.max(-1, Math.min(1, samples[n])) * 32767), true);
  return bytes;
}
function base64(bytes) {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}
export function newAssetId(cryptoSource = globalThis.crypto) {
  if (cryptoSource?.getRandomValues) {
    const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
    return 'audio_' + Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  }
  return `audio_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
export async function upload(bridge, id, file, onProgress) {
  const bytes = await encodeWav(file);
  const assetId = newAssetId();
  for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
    const part = bytes.subarray(offset, offset + 256 * 1024);
    await request(bridge, { action: 'upload', id, assetId, offset, data: base64(part), final: offset + part.length === bytes.length });
    onProgress?.(Math.round((offset + part.length) / bytes.length * 100));
  }
  return assetId;
}
export async function getRecording(bridge, id, file) {
  const parts = [];
  let offset = 0;
  while (true) {
    const part = await request(bridge, { action: 'recording', id, file, offset });
    parts.push(Uint8Array.from(atob(part.data), c => c.charCodeAt(0)));
    if (part.nextOffset >= part.size) break;
    if (part.nextOffset <= offset) throw new Error('录音下载无进度');
    offset = part.nextOffset;
  }
  return new Blob(parts, { type: 'audio/wav' });
}
export async function exportRun(bridge, id, onProgress) {
  const [{ default: JSZip }, { saveAs }] = await Promise.all([import('jszip'), import('file-saver')]);
  const { html, run, recordings } = await request(bridge, { action: 'report', id });
  const zip = new JSZip();
  zip.file('report.html', html);
  zip.file('results.json', JSON.stringify(run, null, 2));
  zip.file('config.json', JSON.stringify({ ...run.config, calibration: run.calibration, timing: run.timing, templates: run.templates }, null, 2));
  for (let n = 0; n < recordings.length; n++) {
    onProgress?.(`打包录音 ${n + 1} / ${recordings.length}`);
    zip.file(recordings[n], await getRecording(bridge, id, recordings[n]));
  }
  saveAs(await zip.generateAsync({ type: 'blob' }), `speaker-blackbox-${id}.zip`);
}
