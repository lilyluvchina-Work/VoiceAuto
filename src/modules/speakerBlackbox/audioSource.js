import { selectGeneratedTestAudios } from '../../utils/testAudioStatus.js';
import { fetchStoredTestAudioBlob } from '../../services/testAudioApi.js';

export const DEVICE_TYPES = { xiaomi: ['小米音箱', '小爱同学', 'zh'], baidu: ['百度音箱', '小度小度', 'zh'], google: ['Google 音箱', 'OKGoogle', 'en'] };
const RESPONSES = {
  xiaomi: { text: '我在 / 你说 / 诶 / 哎 / 在呢 / 哎，在呢 / 在 / 怎么了，我在', responses: ['我在', '你说', '诶', '哎', '在呢', '哎，在呢', '在', '怎么了，我在'], kind: 'speech', userProvidedResponses: ['在', '怎么了，我在'],
    source: { title: '小米 AI 音箱应答测评', url: 'https://read01.com/gg7Bed5.html', level: '公开测评、使用记录及用户补充，非所有型号保证' },
    additionalSources: [{ title: '小爱音箱实际体验（界面）', url: 'https://www.jiemian.com/article/2768094.html' },
      { title: '小爱音箱使用体验（苏宁）', url: 'https://news.suning.com/m/wtoutiao/bcdetail/8360734339.html' }] },
  baidu: { text: '在呢 / 来喽哦 / 嗯 / 哎 / 我在', responses: ['在呢', '来喽哦', '嗯', '哎', '我在'], userProvidedResponses: ['来喽哦', '嗯', '哎', '我在'], kind: 'speech', source: { title: '小度在家 1C 使用记录（什么值得买）', url: 'https://post.smzdm.com/talk/p/alpoq8rg/', level: '特定型号使用记录及用户补充，非所有型号保证' } },
  google: { text: '唤醒提示音', kind: 'tone', source: { title: 'Google 官方：开启唤醒提示音', url: 'https://support.google.com/googlehome/answer/7410241?hl=en-uk', level: '官方设置说明' } },
};
export const wakeResponsePreset = type => RESPONSES[type] || RESPONSES.xiaomi;
export function migrateWakeResponse(config = {}) {
  if (config.deviceType === 'google' && (!config.wakeWord || config.wakeWord === 'Hey Google')) return { ...config, wakeWord: 'OKGoogle' };
  const oldDefault = (config.wakeResponse === '我在' && !config.wakeResponsePresetVersion)
    || (config.wakeResponse === '我在 / 你说 / 诶 / 哎 / 在呢 / 哎，在呢' && (config.wakeResponsePresetVersion || 0) < 3);
  if ((config.deviceType || 'xiaomi') === 'xiaomi' && oldDefault) {
    return { ...config, wakeResponse: RESPONSES.xiaomi.text, wakeResponseSource: { ...RESPONSES.xiaomi.source }, wakeResponsePresetVersion: 3 };
  }
  if (config.deviceType === 'baidu' && config.wakeResponse === '在呢' && (config.wakeResponsePresetVersion || 0) < 4) {
    return { ...config, wakeResponse: RESPONSES.baidu.text, wakeResponseSource: { ...RESPONSES.baidu.source }, wakeResponsePresetVersion: 4 };
  }
  return config;
}
export function deviceWakeConfig(type, profile = {}) {
  const preset = wakeResponsePreset(type);
  return { ...profile, deviceType: type, wakeWord: DEVICE_TYPES[type][1], language: DEVICE_TYPES[type][2],
    wakeResponse: preset.text, templateKind: preset.kind, wakeResponseSource: { ...preset.source }, wakeResponsePresetVersion: 4,
    wakeDetectionMode: profile.wakeDetectionMode || (type === 'google' ? 'template_only' : 'speech_or_template'), wakeMinVoiceMs: profile.wakeMinVoiceMs ?? 80 };
}
export function selectAudioDevices(devices, current = {}) {
  const select = (kind, selected) => devices.find(d => d.kind === kind && d.deviceId === selected)
    || devices.find(d => d.kind === kind && d.default) || devices.find(d => d.kind === kind);
  return { inputDeviceId: select('input', current.inputDeviceId)?.deviceId || '', outputDeviceId: select('output', current.outputDeviceId)?.deviceId || '' };
}
export function selectTestAudios(audios, selectedModule = 'all') {
  return selectGeneratedTestAudios(audios, selectedModule);
}
export async function resolveAudioFile(audio, fetchBlob = fetchStoredTestAudioBlob) {
  const blob = audio.audioBlob || (audio.audioUrl ? await fetchBlob(audio.audioUrl) : null);
  if (!blob?.size) throw new Error(`测试音频 ${audio.caseTitle || audio.text || audio.id} 不可用，请到测试用例管理重新生成`);
  return new File([blob], audio.caseTitle || audio.name || audio.text?.slice(0, 60) || `${audio.id}.audio`, { type: blob.type });
}
