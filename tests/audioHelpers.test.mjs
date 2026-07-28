import assert from 'node:assert/strict';
import { playAudioItem } from '../src/utils/audioHelpers.js';

let spoken = null;
const ttsService = {
  speak(text, config) {
    spoken = { text, config };
    return Promise.resolve();
  },
};

await playAudioItem(
  {
    source: 'tts',
    text: 'Turn on the living room light.',
    config: {
      voiceType: 'en_female_skye_emo_v2_mars_bigtts',
      voiceName: 'Skye',
      lang: 'en-US',
      volume: 80,
      rate: 1.2,
    },
  },
  ttsService,
  {
    voiceType: 'zh_female_shuangkuaisisi_moon_bigtts',
    voiceName: '爽快思思',
    lang: 'zh-CN',
    volume: 100,
    rate: 1,
  }
);

assert.equal(spoken.text, 'Turn on the living room light.');
assert.equal(spoken.config.voiceType, 'en_female_dacey_uranus_bigtts');
assert.equal(spoken.config.voiceName, 'Dacey');
assert.equal(spoken.config.lang, 'en-US');
assert.equal(spoken.config.volume, 80);
assert.equal(spoken.config.rate, 1.2);

await playAudioItem(
  {
    source: 'tts',
    text: '打开客厅的灯',
    config: {
      voice: 'xiaoxiao',
      voiceName: '晓晓',
      lang: 'zh-CN',
      volume: 90,
      rate: 1.1,
    },
  },
  ttsService,
  {
    voice: 'zh_female_shuangkuaisisi_moon_bigtts',
    voiceType: 'zh_female_shuangkuaisisi_moon_bigtts',
    voiceName: '爽快思思',
    provider: 'doubao-v3',
    lang: 'zh-CN',
    volume: 100,
    rate: 1,
  }
);

assert.equal(spoken.text, '打开客厅的灯');
assert.equal(spoken.config.voiceType, 'zh_female_wanwanxiaohe_moon_bigtts');
assert.equal(spoken.config.voiceName, '湾湾小何');
assert.equal(spoken.config.voice, 'zh-CN:zh_female_wanwanxiaohe_moon_bigtts');
assert.equal(spoken.config.volume, 90);
assert.equal(spoken.config.rate, 1.1);
