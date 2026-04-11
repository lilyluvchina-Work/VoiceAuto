/**
 * 音频导入组件
 */
import React, { useState, useRef } from 'react';
import { useTest, actions } from '../stores/testStore';
import ttsService from '../services/ttsService.jsx';
import {
  readTextFile,
  parseTestCases,
  parseTestCasesWithModule,
  isValidAudioFile,
  getAudioDuration,
  generateId
} from '../utils/audioUtils.jsx';

const MODULE_OPTIONS = [
  '未分类',
  '音乐控制',
  '家居控制',
  '导航出行',
  '天气与资讯',
  '系统控制'
];

export default function AudioImporter() {
  const { state, dispatch } = useTest();
  const { defaultVoiceConfig } = state;

  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [importMode, setImportMode] = useState('text');
  const [selectedModule, setSelectedModule] = useState('未分类');
  const [customModule, setCustomModule] = useState('');
  const fileInputRef = useRef(null);
  const resolvedModule = selectedModule === '__custom__'
    ? (customModule.trim() || '未分类')
    : selectedModule;

  // 处理文本导入
  const handleTextImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const content = await readTextFile(file);
      const cases = parseTestCasesWithModule(content, resolvedModule);

      if (cases.length === 0) {
        alert('文件内容为空或格式不正确');
        return;
      }

      setIsGenerating(true);
      let successCount = 0;

      for (const item of cases) {
        try {
          // Web Speech API 无法生成音频文件，只能播放
          // 这里添加播放记录，播放时使用 TTS
          const id = generateId();
          dispatch(actions.addTestAudio({
            id,
            text: item.text,
            module: item.module || resolvedModule,
            source: 'tts',
            audioBlob: null,
            audioUrl: null,
            duration: 0,
            config: { ...defaultVoiceConfig }
          }));

          successCount++;
        } catch (err) {
          console.error(`Failed to add: ${item.text}`, err);
        }
      }

      alert(`成功导入 ${successCount} 条测试用例`);
    } catch (err) {
      console.error('Import failed:', err);
      alert('导入失败：' + err.message);
    } finally {
      setIsGenerating(false);
      e.target.value = '';
    }
  };

  // 处理音频文件导入
  const handleFileImport = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    let successCount = 0;

    for (const file of files) {
      if (!isValidAudioFile(file)) {
        console.warn(`Invalid file format: ${file.name}`);
        continue;
      }

      try {
        const url = URL.createObjectURL(file);
        const duration = await getAudioDuration(url);

        dispatch(actions.addTestAudio({
          id: generateId(),
          text: file.name.replace(/\.[^/.]+$/, ''),
          module: resolvedModule,
          source: 'file',
          audioBlob: null,
          audioUrl: url,
          duration,
          originalFile: file,
          config: { ...defaultVoiceConfig }
        }));

        successCount++;
      } catch (err) {
        console.error(`Failed to import: ${file.name}`, err);
      }
    }

    if (successCount > 0) {
      alert(`成功导入 ${successCount} 个音频文件`);
    }

    e.target.value = '';
  };

  // 处理手动输入
  const handleManualAdd = async () => {
    if (!inputText.trim()) {
      alert('请输入文本内容');
      return;
    }

    const lines = parseTestCases(inputText);
    if (lines.length === 0) {
      alert('请输入有效的文本内容');
      return;
    }

    let successCount = 0;

    for (const text of lines) {
      const id = generateId();
      dispatch(actions.addTestAudio({
        id,
        text,
        module: resolvedModule,
        source: 'tts',
        audioBlob: null,
        audioUrl: null,
        duration: 0,
        config: { ...defaultVoiceConfig }
      }));
      successCount++;
    }

    setInputText('');

    if (successCount > 0) {
      alert(`成功添加 ${successCount} 条测试音频`);
    }
  };

  return (
    <div className="bg-dark rounded-xl p-6 border border-gray-700">
      <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
        <span className="text-2xl">📥</span>
        导入测试音频
      </h2>

      <div className="mb-6 p-4 bg-gray-800/40 border border-gray-700 rounded-lg space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="text-sm text-gray-300 min-w-[96px]">功能模块</label>
          <select
            value={selectedModule}
            onChange={(e) => setSelectedModule(e.target.value)}
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg
                     text-white text-sm focus:border-primary"
          >
            {MODULE_OPTIONS.map((moduleName) => (
              <option key={moduleName} value={moduleName}>{moduleName}</option>
            ))}
            <option value="__custom__">自定义模块...</option>
          </select>
        </div>

        {selectedModule === '__custom__' && (
          <input
            type="text"
            value={customModule}
            onChange={(e) => setCustomModule(e.target.value)}
            placeholder="输入自定义模块名，例如：车控功能"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg
                     text-white text-sm placeholder-gray-500 focus:border-primary"
          />
        )}

        <p className="text-xs text-gray-500">
          当前导入内容将归类到模块：<span className="text-primary">{resolvedModule}</span>
        </p>
      </div>

      {/* 导入模式切换 */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setImportMode('text')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            importMode === 'text'
              ? 'bg-primary text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          📄 文本导入
        </button>
        <button
          onClick={() => setImportMode('file')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            importMode === 'file'
              ? 'bg-primary text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          📁 文件导入
        </button>
        <button
          onClick={() => setImportMode('manual')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            importMode === 'manual'
              ? 'bg-primary text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          ✏️ 手动输入
        </button>
      </div>

      {/* 文本导入模式 */}
      {importMode === 'text' && (
        <div className="space-y-4">
          <div className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center
                        hover:border-primary transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              onChange={handleTextImport}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isGenerating}
              className="px-6 py-3 bg-primary hover:bg-blue-600 disabled:bg-gray-600
                       rounded-lg font-medium transition-colors"
            >
              {isGenerating ? '导入中...' : '选择 .txt 文件'}
            </button>
            <p className="mt-3 text-sm text-gray-400">
              每行作为一条独立的测试用例
            </p>
          </div>
        </div>
      )}

      {/* 文件导入模式 */}
      {importMode === 'file' && (
        <div className="space-y-4">
          <div className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center
                        hover:border-primary transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.wav,.ogg,.m4a"
              multiple
              onChange={handleFileImport}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-3 bg-secondary hover:bg-indigo-600
                       rounded-lg font-medium transition-colors"
            >
              选择音频文件
            </button>
            <p className="mt-3 text-sm text-gray-400">
              支持 mp3, wav, ogg, m4a 格式，可多选
            </p>
          </div>
        </div>
      )}

      {/* 手动输入模式 */}
      {importMode === 'manual' && (
        <div className="space-y-4">
          <div>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="输入测试文本，每行一条用例&#10;例如：&#10;帮我把客厅的灯打开&#10;今天天气怎么样"
              className="w-full h-32 px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg
                       focus:border-primary focus:ring-1 focus:ring-primary
                       text-white placeholder-gray-500 resize-none"
            />
          </div>
          <button
            onClick={handleManualAdd}
            disabled={!inputText.trim()}
            className="w-full px-4 py-3 bg-accent hover:bg-emerald-600 disabled:bg-gray-600
                     rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            <span>➕</span>
            添加到播放列表
          </button>
        </div>
      )}

      {/* 提示 */}
      <div className="mt-6 p-4 bg-gray-800/50 rounded-lg">
        <p className="text-xs text-gray-400 mb-2 font-medium">💡 提示</p>
        <ul className="text-xs text-gray-500 space-y-1">
          <li>• 文本导入：支持按标题自动识别模块（如 # 音乐控制）</li>
          <li>• 文件导入：直接使用现有音频文件</li>
          <li>• 手动输入：适合单条或少量用例</li>
          <li>• 无法识别模块时，将归类到当前选择的模块</li>
        </ul>
      </div>
    </div>
  );
}