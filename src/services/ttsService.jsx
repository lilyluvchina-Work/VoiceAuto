/**
 * TTS 服务
 * 优先支持豆包 TTS（可配置），不可用时自动回退到 Web Speech API。
 */
import { CONFIG_TYPES, readConfig as readSecureConfig } from '../modules/config/secureConfigStore';
import { resolveDoubaoClientProxyPath, shouldFallbackToWebSpeech, shouldUseDoubaoTts } from './ttsRouting';

const DEFAULT_DOUBAO_URL = 'https://openspeech.bytedance.com/api/v1/tts';
const WEB_SPEECH_START_TIMEOUT_MS = 2500;
const WEB_SPEECH_QUEUE_RESET_MS = 80;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TTSService {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voices = [];
    this.voicesLoaded = false;
    this.voicesPromise = null;
    this.currentAudio = null;
    this.currentUtterance = null;

    this.provider = (import.meta.env.VITE_TTS_PROVIDER || 'webspeech').toLowerCase();
    this.doubaoConfig = this.resolveDoubaoConfig();

    if (this.synth) {
      this.initVoices();
    }
  }

  initVoices() {
    if (this.voices.length > 0) {
      this.voicesLoaded = true;
      return Promise.resolve();
    }

    if (this.voicesPromise) {
      return this.voicesPromise;
    }

    this.voicesPromise = new Promise((resolve) => {
      const loadVoices = () => {
        this.voices = this.synth.getVoices() || [];
        this.voicesLoaded = this.voices.length > 0;
        resolve();
      };

      loadVoices();

      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = loadVoices;
      }

      setTimeout(() => {
        if (!this.voicesLoaded) {
          resolve();
        }
      }, 3000);
    });

    return this.voicesPromise;
  }

  getAllVoices() {
    return this.voices.map((v) => ({ name: v.name, lang: v.lang }));
  }

  isDoubaoReady() {
    this.doubaoConfig = this.resolveDoubaoConfig();
    if (this.doubaoConfig.apiVersion === 'v3') {
      return true;
    }
    const { url, accessKeyId, secretAccessKey } = this.doubaoConfig;
    return Boolean(url && accessKeyId && secretAccessKey);
  }

  resolveDoubaoConfig() {
    const secureConfig = readSecureConfig(CONFIG_TYPES.DOUBAO_TTS, { includeSecrets: true });
    if (secureConfig.configured) {
      this.provider = (secureConfig.provider || 'doubao').toLowerCase();
      return {
        apiVersion: secureConfig.apiVersion || 'v3',
        v3Url: resolveDoubaoClientProxyPath(secureConfig.clientProxyPath || secureConfig.v3ProxyPath || secureConfig.proxyPath),
        resourceId: secureConfig.resourceId || 'seed-tts-2.0',
        url: secureConfig.url || DEFAULT_DOUBAO_URL,
        accessKeyId: secureConfig.accessKeyId || secureConfig.appId || '',
        secretAccessKey: secureConfig.secretAccessKey || secureConfig.accessToken || '',
        cluster: secureConfig.cluster || 'volcano_tts',
        defaultVoiceType: secureConfig.defaultVoiceType || 'zh_female_roumei_moon_bigtts',
        uid: secureConfig.uid || 'voiceauto-web',
        sampleRate: Number(secureConfig.sampleRate || 24000)
      };
    }

    return {
      apiVersion: import.meta.env.VITE_DOUBAO_API_VERSION || 'v3',
      v3Url: resolveDoubaoClientProxyPath(import.meta.env.VITE_DOUBAO_V3_PROXY_PATH),
      resourceId: import.meta.env.VITE_DOUBAO_RESOURCE_ID || 'seed-tts-2.0',
      url: import.meta.env.VITE_DOUBAO_TTS_URL || DEFAULT_DOUBAO_URL,
      accessKeyId: import.meta.env.VITE_DOUBAO_ACCESS_KEY_ID || import.meta.env.VITE_DOUBAO_APP_ID || '',
      secretAccessKey: import.meta.env.VITE_DOUBAO_SECRET_ACCESS_KEY || import.meta.env.VITE_DOUBAO_ACCESS_TOKEN || '',
      cluster: import.meta.env.VITE_DOUBAO_CLUSTER || 'volcano_tts',
      defaultVoiceType: import.meta.env.VITE_DOUBAO_VOICE_TYPE || 'zh_female_roumei_moon_bigtts',
      uid: import.meta.env.VITE_DOUBAO_UID || 'voiceauto-web',
      sampleRate: Number(import.meta.env.VITE_DOUBAO_SAMPLE_RATE || 24000)
    };
  }

  buildDoubaoVoiceType(config) {
    const byValueMap = {
      xiaoxiao: 'zh_female_roumei_moon_bigtts',
      xiaoyi: 'zh_female_wanwanxiaohe_moon_bigtts',
      xiaomeng: 'zh_female_shuangkuaisisi_moon_bigtts',
      xiaoxuan: 'zh_female_linjianvhai_moon_bigtts',
      yunxi: 'zh_male_qingshuangjingshen_moon_bigtts',
      yunjian: 'zh_male_wennuanahu_moon_bigtts',
      xiaoyun: 'zh_male_shaonianzixin_moon_bigtts'
    };

    if (config.voiceType) {
      return config.voiceType;
    }

    if (config.voice && byValueMap[config.voice]) {
      return byValueMap[config.voice];
    }

    if (config.voice && String(config.voice).includes('_')) {
      return config.voice;
    }

    if (config.voiceName && config.voiceName.includes('_')) {
      return config.voiceName;
    }

    return this.doubaoConfig.defaultVoiceType;
  }

  createReqId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  base64ToBlob(base64, mimeType = 'audio/mpeg') {
    const normalized = base64.includes(',') ? base64.split(',')[1] : base64;
    const binary = atob(normalized);
    const len = binary.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes], { type: mimeType });
  }

  async playBlob(blob, config = {}) {
    this.stopAudio();

    const audioUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const audioEl = new Audio(audioUrl);
      this.currentAudio = audioEl;

      audioEl.onended = () => {
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
        resolve();
      };

      audioEl.onerror = (e) => {
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
        reject(e);
      };

      audioEl.onplaying = () => {
        config.onStart?.();
      };

      audioEl.play().catch((err) => {
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
        reject(err);
      });
    });
  }

  async speakWithDoubao(text, config = {}) {
    if (!this.isDoubaoReady()) {
      throw new Error('豆包 TTS 未配置，请先在配置中心设置 Access Key ID 与 Secret Access Key');
    }

    if (this.doubaoConfig.apiVersion === 'v3') {
      await this.speakWithDoubaoV3(text, config);
      return;
    }

    const { accessKeyId, secretAccessKey, cluster, uid, url } = this.doubaoConfig;
    const voiceType = this.buildDoubaoVoiceType(config);
    const speedRatio = Math.max(0.5, Math.min(2, config.rate || 1.0));
    const volumeRatio = Math.max(0.1, Math.min(2, (config.volume || 100) / 100));

    const payload = {
      app: {
        appid: accessKeyId,
        token: secretAccessKey,
        cluster
      },
      user: {
        uid
      },
      audio: {
        voice_type: voiceType,
        encoding: 'mp3',
        speed_ratio: speedRatio,
        volume_ratio: volumeRatio
      },
      request: {
        reqid: this.createReqId(),
        text,
        text_type: 'plain',
        operation: 'query'
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secretAccessKey}`
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result?.message || `豆包 TTS 请求失败: ${response.status}`);
    }

    const audioBase64 = result?.data || result?.audio || result?.result?.audio;
    if (!audioBase64) {
      throw new Error('豆包 TTS 返回结果缺少音频数据');
    }

    const blob = this.base64ToBlob(audioBase64, 'audio/mpeg');
    await this.playBlob(blob, config);
  }

  async speakWithDoubaoV3(text, config = {}) {
    const voiceType = this.buildDoubaoVoiceType(config);
    if (!voiceType) {
      throw new Error('豆包 V3 TTS 音色未配置');
    }

    const response = await fetch(this.doubaoConfig.v3Url || '/api/tts/doubao-v3', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        voiceType,
        lang: config.lang,
        rate: config.rate,
        volume: config.volume
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      let message = errorText;
      try {
        const parsed = JSON.parse(errorText);
        message = parsed.message || message;
      } catch {
        // Keep plain text error.
      }
      throw new Error(message || `豆包 V3 TTS 请求失败：${response.status}`);
    }

    const blob = await response.blob();
    await this.playBlob(blob, config);
  }

  async getVoice(config) {
    const { voiceName, lang } = config;

    await this.initVoices();

    if (this.voices.length === 0) {
      return null;
    }

    const edgeVoiceMappings = {
      晓晓: ['Microsoft Yaoyao', 'Yaoyao', 'Huihui', 'Kangkang', 'xiaoxiao', 'Yunxia'],
      晓伊: ['Microsoft Yiyu', 'Yiyu', 'xiaoyi'],
      云希: ['Microsoft Yunxi', 'Yunxi', 'xiaoyi'],
      云健: ['Microsoft Yunyang', 'Yunyang', 'yunjian', 'Yunjian'],
      小云: ['Microsoft Xiaoyun', 'Xiaoyun', 'xiaoyun'],
      小蒙: ['Xiaomeng', 'xiaomeng'],
      小璇: ['Xiaoxuan', 'xiaoxuan']
    };

    const searchTerms = edgeVoiceMappings[voiceName] || [voiceName];

    let langPref = 'zh';
    if (lang === '粤语') {
      langPref = 'zh-HK';
    } else if (lang === 'en-US' || lang === 'English') {
      langPref = 'en';
    }

    let candidates = this.voices.filter((v) => {
      const vLang = v.lang.toLowerCase();
      const pref = langPref.toLowerCase();
      return vLang.startsWith(pref) || vLang.includes(pref);
    });

    if (candidates.length === 0) {
      candidates = this.voices;
    }

    for (const term of searchTerms) {
      const match = candidates.find((v) =>
        v.name.toLowerCase().includes(term.toLowerCase())
      );
      if (match) {
        return match;
      }
    }

    return candidates[0];
  }

  createWebSpeechUtterance(text, config, selectedVoice) {
    const { lang = 'zh-CN', volume = 100, rate = 1.0 } = config;
    const utterance = new SpeechSynthesisUtterance(text);

    if (lang === '粤语') {
      utterance.lang = 'zh-HK';
    } else if (lang === '东北话' || lang === '陕西话' || lang === '四川话') {
      utterance.lang = 'zh-CN';
    } else {
      utterance.lang = lang;
    }

    utterance.volume = Math.min(1.0, volume / 100);
    utterance.rate = Math.max(0.1, Math.min(10, rate));
    utterance.pitch = 1.0;

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    return utterance;
  }

  async speakWebSpeechOnce(text, config = {}, selectedVoice = null) {
    const utterance = this.createWebSpeechUtterance(text, config, selectedVoice);

    return new Promise((resolve, reject) => {
      if (!this.synth) {
        reject(new Error('浏览器不支持语音合成'));
        return;
      }

      let settled = false;
      let started = false;

      const startTimer = setTimeout(() => {
        if (settled || started) return;
        settled = true;
        this.synth.cancel();
        this.currentUtterance = null;
        reject(new Error('浏览器语音合成未开始播放，已自动重试'));
      }, WEB_SPEECH_START_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(startTimer);
        if (this.currentUtterance === utterance) {
          this.currentUtterance = null;
        }
      };

      utterance.onstart = () => {
        started = true;
        config.onStart?.();
      };

      utterance.onend = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (!started) {
          reject(new Error('浏览器语音合成未实际开始播放'));
          return;
        }
        resolve();
      };

      utterance.onerror = (e) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(e?.error || e?.message || '浏览器语音合成播放失败'));
      };

      this.currentUtterance = utterance;
      this.synth.speak(utterance);
    });
  }

  async speakWithWebSpeech(text, config = {}) {
    if (!this.synth) {
      throw new Error('浏览器不支持语音合成');
    }

    const { voiceName, lang = 'zh-CN' } = config;
    const selectedVoice = await this.getVoice({ voiceName, lang });
    let lastError = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      this.stopAudio();
      await delay(WEB_SPEECH_QUEUE_RESET_MS);

      if (this.synth.paused) {
        this.synth.resume();
      }

      try {
        await this.speakWebSpeechOnce(text, config, selectedVoice);
        return;
      } catch (err) {
        lastError = err;
        console.warn(`[TTS] Web Speech attempt ${attempt} failed:`, err);
        this.stopAudio();
        await delay(WEB_SPEECH_QUEUE_RESET_MS * attempt);
      }
    }

    throw lastError || new Error('浏览器语音合成播放失败');
  }

  async speak(text, config = {}) {
    if (!text || !text.trim()) {
      return;
    }

    const preferDoubao = shouldUseDoubaoTts({
      serviceProvider: this.provider,
      requestConfig: config,
    });

    if (preferDoubao) {
      try {
        await this.speakWithDoubao(text, config);
        return;
      } catch (err) {
        if (!shouldFallbackToWebSpeech({ requestConfig: config })) {
          console.error('[TTS] Doubao V3 failed and Web Speech fallback is disabled for fixed voiceType:', err);
          throw err;
        }
        console.warn('[TTS] Doubao failed, fallback to Web Speech:', err);
      }
    }

    await this.speakWithWebSpeech(text, config);
  }

  stopAudio() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }

    this.currentUtterance = null;

    if (this.synth) {
      this.synth.cancel();
    }
  }
}

export default new TTSService();
