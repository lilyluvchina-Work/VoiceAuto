/**
 * 音频配置组件
 */
import React from 'react';
import { useTest, actions } from '../stores/testStore';
import { VOICE_OPTIONS, LANG_OPTIONS } from '../constants';

export default function VoiceConfig() {
  const { state, dispatch } = useTest();
  const { defaultVoiceConfig } = state;

  const handleVoiceChange = (e) => {
    const selected = VOICE_OPTIONS.find(v => v.value === e.target.value);
    dispatch(actions.setVoiceConfig({
      voice: e.target.value,
      voiceName: selected ? selected.label.split('（')[0] : e.target.value
    }));
  };

  const handleLangChange = (e) => {
    dispatch(actions.setVoiceConfig({ lang: e.target.value }));
  };

  const handleVolumeChange = (e) => {
    dispatch(actions.setVoiceConfig({ volume: parseInt(e.target.value) }));
  };

  const handleRateChange = (e) => {
    dispatch(actions.setVoiceConfig({ rate: parseFloat(e.target.value) }));
  };

  return (
    <div className="bg-dark rounded-xl p-6 border border-gray-700">
      <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
        <span className="text-2xl">🎛️</span>
        音频配置
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 音色选择 */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            音色选择
          </label>
          <select
            value={defaultVoiceConfig.voice}
            onChange={handleVoiceChange}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg
                     focus:border-primary focus:ring-1 focus:ring-primary
                     text-white appearance-none cursor-pointer"
          >
            <option value="" disabled>选择音色</option>
            <optgroup label="女声">
              {VOICE_OPTIONS.filter(v => v.gender === 'female').map(v => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </optgroup>
            <optgroup label="男声">
              {VOICE_OPTIONS.filter(v => v.gender === 'male').map(v => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* 语种/方言选择 */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            语种 / 方言
          </label>
          <select
            value={defaultVoiceConfig.lang}
            onChange={handleLangChange}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg
                     focus:border-primary focus:ring-1 focus:ring-primary
                     text-white appearance-none cursor-pointer"
          >
            {LANG_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* 音量调节 */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm text-gray-300 font-medium">
              音量
            </label>
            <span className="px-3 py-1 bg-primary/20 text-primary rounded-lg font-mono font-bold">
              {defaultVoiceConfig.volume}%
            </span>
          </div>
          <div className="relative">
            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-primary rounded-full transition-all"
                style={{ width: `${(defaultVoiceConfig.volume / 200) * 100}%` }}
              ></div>
            </div>
            <input
              type="range"
              min="0"
              max="200"
              step="5"
              value={defaultVoiceConfig.volume}
              onChange={handleVolumeChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span className="px-2 py-0.5 bg-gray-700 rounded">0%</span>
            <span className="px-2 py-0.5 bg-gray-700 rounded">100%</span>
            <span className="px-2 py-0.5 bg-gray-700 rounded">200%</span>
          </div>
        </div>

        {/* 播放倍速 */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm text-gray-300 font-medium">
              播放倍速
            </label>
            <span className="px-3 py-1 bg-primary/20 text-primary rounded-lg font-mono font-bold">
              {defaultVoiceConfig.rate.toFixed(1)}x
            </span>
          </div>
          <div className="relative">
            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all"
                style={{ width: `${((defaultVoiceConfig.rate - 0.5) / 1.5) * 100}%` }}
              ></div>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={defaultVoiceConfig.rate}
              onChange={handleRateChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span className="px-2 py-0.5 bg-gray-700 rounded">0.5x</span>
            <span className="px-2 py-0.5 bg-gray-700 rounded">1.0x</span>
            <span className="px-2 py-0.5 bg-gray-700 rounded">2.0x</span>
          </div>
        </div>
      </div>

      {/* 配置预览 */}
      <div className="mt-6 p-4 bg-gray-800/50 rounded-lg">
        <p className="text-xs text-gray-400 mb-2 font-medium">当前配置预览</p>
        <div className="flex flex-wrap gap-2">
          <span className="px-3 py-1.5 bg-primary/20 text-primary rounded-full text-sm">
            {defaultVoiceConfig.voiceName}
          </span>
          <span className="px-3 py-1.5 bg-secondary/20 text-secondary rounded-full text-sm">
            {LANG_OPTIONS.find(l => l.value === defaultVoiceConfig.lang)?.label || defaultVoiceConfig.lang}
          </span>
          <span className="px-3 py-1.5 bg-accent/20 text-accent rounded-full text-sm">
            音量 {defaultVoiceConfig.volume}%
          </span>
          <span className="px-3 py-1.5 bg-amber-500/20 text-amber-400 rounded-full text-sm">
            倍速 {defaultVoiceConfig.rate.toFixed(1)}x
          </span>
        </div>
      </div>
    </div>
  );
}
