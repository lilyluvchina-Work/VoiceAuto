/**
 * 唤醒词配置组件
 */
import React, { useState } from 'react';
import { useTest, actions } from '../stores/testStore';
import ttsService from '../services/ttsService.jsx';

export default function WakeWordConfig() {
  const { state, dispatch } = useTest();
  const { wakeWord, defaultVoiceConfig } = state;
  const [isPlaying, setIsPlaying] = useState(false);

  // 处理唤醒词文本变化
  const handleTextChange = (e) => {
    dispatch(actions.setWakeWord(e.target.value));
  };

  // 处理唤醒后延迟变化
  const handleWakeAfterDelayChange = (e) => {
    dispatch(actions.setWakeDelay(parseInt(e.target.value)));
  };

  // 处理唤醒间延迟变化
  const handleWakeIntervalDelayChange = (e) => {
    dispatch(actions.setWakeIntervalDelay(parseInt(e.target.value)));
  };

  // 试听唤醒音频
  const handlePlay = async () => {
    if (!wakeWord.text.trim()) {
      alert('请输入唤醒词');
      return;
    }

    if (isPlaying) {
      ttsService.stopAudio();
      setIsPlaying(false);
      return;
    }

    setIsPlaying(true);
    try {
      await ttsService.speak(wakeWord.text, {
        voiceName: defaultVoiceConfig.voiceName,
        lang: defaultVoiceConfig.lang,
        volume: 200,
        rate: defaultVoiceConfig.rate
      });
    } catch (error) {
      console.error('Playback failed:', error);
      alert('播放失败：' + error.message);
    } finally {
      setIsPlaying(false);
    }
  };

  return (
    <div className="bg-dark rounded-xl p-6 border border-gray-700">
      <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
        <span className="text-2xl">🔔</span>
        唤醒词配置
      </h2>

      <div className="space-y-5">
        {/* 唤醒词文本 */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            唤醒词文本
          </label>
          <input
            type="text"
            value={wakeWord.text}
            onChange={handleTextChange}
            placeholder="输入唤醒词，如：Hey, Cedar"
            className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg
                     focus:border-primary focus:ring-1 focus:ring-primary
                     text-white placeholder-gray-500"
          />
        </div>

        {/* 唤醒后延迟 */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm text-gray-400">
              唤醒后延迟
            </label>
            <select
              value={wakeWord.wakeAfterDelay}
              onChange={handleWakeAfterDelayChange}
              className="px-3 py-1.5 bg-gray-800 border border-gray-600 rounded-lg
                       text-primary font-mono text-sm focus:border-primary"
            >
              <option value="300">300ms</option>
              <option value="500">500ms</option>
              <option value="1000">1000ms</option>
              <option value="1500">1500ms</option>
            </select>
          </div>
          <p className="text-xs text-gray-500">
            唤醒词播放完毕后，到播放测试音频的等待时间
          </p>
        </div>

        {/* 唤醒间延迟 */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm text-gray-400">
              唤醒间延迟
            </label>
            <select
              value={wakeWord.wakeIntervalDelay}
              onChange={handleWakeIntervalDelayChange}
              className="px-3 py-1.5 bg-gray-800 border border-gray-600 rounded-lg
                       text-primary font-mono text-sm focus:border-primary"
            >
              <option value="3000">3000ms</option>
              <option value="5000">5000ms</option>
              <option value="10000">10000ms</option>
              <option value="20000">20000ms</option>
            </select>
          </div>
          <p className="text-xs text-gray-500">
            测试音频播放完毕后，到再次播放唤醒词的等待时间
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={handlePlay}
            disabled={!wakeWord.text.trim()}
            className="flex-1 px-4 py-2.5 bg-accent hover:bg-emerald-600 disabled:bg-gray-600
                     rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            {isPlaying ? (
              <>
                <span>⏹</span>
                停止
              </>
            ) : (
              <>
                <span>▶</span>
                试听唤醒词
              </>
            )}
          </button>
        </div>
      </div>

      {/* 时间轴示意 */}
      <div className="mt-6 p-4 bg-gray-800/50 rounded-lg">
        <p className="text-xs text-gray-400 mb-3 font-medium">📊 播放时间轴示意</p>
        <div className="flex items-center gap-2 text-xs overflow-x-auto pb-2">
          <div className="flex-shrink-0 px-3 py-2 bg-primary/20 rounded text-primary">
            唤醒词
          </div>
          <div className="text-gray-500">→</div>
          <div className="flex-shrink-0 px-3 py-2 bg-blue-500/20 rounded text-blue-400">
            等待 {wakeWord.wakeAfterDelay}ms
          </div>
          <div className="text-gray-500">→</div>
          <div className="flex-shrink-0 px-3 py-2 bg-accent/20 rounded text-accent">
            测试音频
          </div>
          <div className="text-gray-500">→</div>
          <div className="flex-shrink-0 px-3 py-2 bg-blue-500/20 rounded text-blue-400">
            等待 {wakeWord.wakeIntervalDelay}ms
          </div>
          <div className="text-gray-500">→</div>
          <div className="flex-shrink-0 px-3 py-2 bg-primary/20 rounded text-primary">
            唤醒词
          </div>
          <div className="text-gray-500">→ ...</div>
        </div>
      </div>
    </div>
  );
}