import React, { useState } from 'react';
import JSZip from 'jszip';
import TapdImportWizard from './TapdImportWizard';
import { useTest, actions } from '../stores/testStore';
import {
  resolveTestCaseDirectory,
  sortTestCasesByDirectoryOrder,
} from '../utils/testCaseOrdering';
import {
  LANG_OPTIONS,
  findVoiceOption,
  getVoiceForLangAndGender,
  getVoiceOptionsForLang,
} from '../constants';
import { buildGeneratedAudioConfig } from '../utils/testCaseAudioConfig';
import { isGeneratedTestAudio } from '../utils/testAudioStatus';
import {
  fetchStoredTestAudioBlob,
  synthesizeTestAudioBlob,
} from '../services/testAudioApi';

function isTextImportedCase(item) {
  return item?.source === 'text' || item?.importSource === 'text_file' || item?.importSource === 'manual_text';
}

function sortTextImportedFirst(items) {
  return [...(items || [])].sort((left, right) => {
    const leftText = isTextImportedCase(left);
    const rightText = isTextImportedCase(right);
    if (leftText !== rightText) return leftText ? -1 : 1;
    if (leftText && rightText) {
      return Number(right.importedAt || 0) - Number(left.importedAt || 0);
    }
    return 0;
  });
}

function sanitizeFilename(value) {
  return String(value || '测试音频')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '测试音频';
}

function sanitizePathSegment(value) {
  return sanitizeFilename(value || '未分类') || '未分类';
}

function createUniqueFilename(filename, usedNames) {
  if (!usedNames.has(filename)) {
    usedNames.add(filename);
    return filename;
  }

  const dotIndex = filename.lastIndexOf('.');
  const name = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : '';
  let index = 2;
  let next = `${name}_${index}${extension}`;
  while (usedNames.has(next)) {
    index += 1;
    next = `${name}_${index}${extension}`;
  }
  usedNames.add(next);
  return next;
}

function getAudioFilename(item) {
  const extension = String(item.audioFormat || 'mp3').replace(/^\./, '') || 'mp3';
  const baseName = item.caseTitle || item.text || item.id;
  return `${sanitizeFilename(baseName)}.${extension}`;
}

function getGeneratedAudioUrl(item) {
  if (item?.audioUrl) return item.audioUrl;
  return '';
}

async function saveBlobWithPicker(blob, filename) {
  const downloadBlob = () => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  if (typeof window.showSaveFilePicker === 'function' && window.isSecureContext) {
    try {
      const extension = filename.includes('.') ? filename.split('.').pop() : 'mp3';
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: '音频文件',
          accept: {
            [blob.type || 'audio/mpeg']: [`.${extension}`],
          },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      downloadBlob();
      return;
    }
  }

  downloadBlob();
}

async function saveGeneratedAudiosToDirectory(items) {
  const rootHandle = await window.showDirectoryPicker({
    mode: 'readwrite',
  });
  const usedNamesByDirectory = new Map();

  for (const item of items) {
    const directoryName = sanitizePathSegment(resolveTestCaseDirectory(item));
    const directoryHandle = await rootHandle.getDirectoryHandle(directoryName, { create: true });
    const usedNames = usedNamesByDirectory.get(directoryName) || new Set();
    usedNamesByDirectory.set(directoryName, usedNames);

    const filename = createUniqueFilename(getAudioFilename(item), usedNames);
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(item.audioBlob || await fetchStoredTestAudioBlob(getGeneratedAudioUrl(item)));
    await writable.close();
  }
}

async function saveGeneratedAudiosAsZip(items) {
  const zip = new JSZip();
  const usedNamesByDirectory = new Map();

  for (const item of items) {
    const directoryName = sanitizePathSegment(resolveTestCaseDirectory(item));
    const usedNames = usedNamesByDirectory.get(directoryName) || new Set();
    usedNamesByDirectory.set(directoryName, usedNames);
    const filename = createUniqueFilename(getAudioFilename(item), usedNames);
    const blob = item.audioBlob || await fetchStoredTestAudioBlob(getGeneratedAudioUrl(item));
    zip.folder(directoryName).file(filename, blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  await saveBlobWithPicker(zipBlob, `测试音频_${new Date().toISOString().slice(0, 10)}.zip`);
}

function getSaveAudioTitle() {
  if (typeof window.showSaveFilePicker === 'function' && window.isSecureContext) {
    return '保存音频，可选择文件夹和文件名';
  }
  return '当前浏览器会保存到默认下载目录';
}

function getSaveAudioDisabledTitle(item) {
  if (!isGeneratedTestAudio(item)) return '请先生成测试音频';
  if (!getGeneratedAudioUrl(item)) return '当前音频已失效，请重新生成后再保存';
  return getSaveAudioTitle();
}

export default function TestCaseManager() {
  const { state, dispatch } = useTest();
  const [showWizard, setShowWizard] = useState(false);
  const [selectedDirectory, setSelectedDirectory] = useState('all');
  const initialGenerationLang = state?.defaultVoiceConfig?.lang || 'zh-CN';
  const [generationLang, setGenerationLang] = useState(initialGenerationLang);
  const [generationVoice, setGenerationVoice] = useState(
    getVoiceForLangAndGender(initialGenerationLang, state?.defaultVoiceConfig?.gender || 'female')?.value || ''
  );
  const [generatingIds, setGeneratingIds] = useState(() => new Set());
  const [savingIds, setSavingIds] = useState(() => new Set());
  const [isSavingAll, setIsSavingAll] = useState(false);

  const sortedCases = React.useMemo(() => {
    return sortTestCasesByDirectoryOrder(state.testAudios);
  }, [state.testAudios]);

  const directoryOptions = React.useMemo(() => {
    const directories = Array.from(new Set(sortedCases.map((item) => resolveTestCaseDirectory(item))));
    return ['all', ...directories];
  }, [sortedCases]);

  const visibleCases = React.useMemo(() => {
    const cases = selectedDirectory === 'all'
      ? sortedCases
      : sortTestCasesByDirectoryOrder(sortedCases, { directory: selectedDirectory });
    return sortTextImportedFirst(cases);
  }, [sortedCases, selectedDirectory]);

  const textImportedCount = React.useMemo(() => (
    state.testAudios.filter(isTextImportedCase).length
  ), [state.testAudios]);

  const tapdImportedCount = React.useMemo(() => (
    state.testAudios.filter((item) => item.source === 'tapd').length
  ), [state.testAudios]);

  const visibleTextImportedCount = React.useMemo(() => (
    visibleCases.filter(isTextImportedCase).length
  ), [visibleCases]);

  const totalGenerated = React.useMemo(() => {
    return state.testAudios.filter(isGeneratedTestAudio).length;
  }, [state.testAudios]);

  const savableGeneratedAudios = React.useMemo(() => {
    return sortTestCasesByDirectoryOrder(
      state.testAudios.filter((item) => isGeneratedTestAudio(item) && getGeneratedAudioUrl(item))
    );
  }, [state.testAudios]);

  const handleClearCases = () => {
    if (state.testAudios.length === 0) {
      return;
    }

    if (!window.confirm(`确认清空全部 ${state.testAudios.length} 条测试用例吗？`)) {
      return;
    }

    dispatch(actions.clearTestAudios());
  };

  const generationConfig = React.useMemo(() => buildGeneratedAudioConfig({
    voiceValue: generationVoice,
    lang: generationLang,
    volume: state.defaultVoiceConfig.volume,
    rate: state.defaultVoiceConfig.rate,
  }), [generationVoice, generationLang, state.defaultVoiceConfig.volume, state.defaultVoiceConfig.rate]);

  const voiceOptions = React.useMemo(() => getVoiceOptionsForLang(generationLang), [generationLang]);
  const selectedVoice = React.useMemo(() => {
    const current = findVoiceOption(generationVoice);
    if (current?.lang === generationLang) {
      return current;
    }
    return voiceOptions[0] || null;
  }, [generationLang, generationVoice, voiceOptions]);

  React.useEffect(() => {
    const selectedInCurrentLang = voiceOptions.some((voice) => voice.value === generationVoice);
    if (!selectedInCurrentLang && voiceOptions[0]?.value) {
      setGenerationVoice(voiceOptions[0].value);
    }
  }, [generationVoice, voiceOptions]);

  const handleGenerationLangChange = (nextLang) => {
    const currentGender = selectedVoice?.gender || findVoiceOption(generationVoice)?.gender || 'female';
    const nextVoice = getVoiceForLangAndGender(nextLang, currentGender);
    setGenerationLang(nextLang);
    setGenerationVoice(nextVoice?.value || '');
  };

  const buildLocalGeneratedPatch = (item, patch = {}) => ({
    id: item.id,
    audioStatus: 'generated',
    source: item.source || 'tts',
    config: {
      ...(item.config || {}),
      ...generationConfig,
    },
    ...patch,
  });

  const createGenerationRequest = (item) => ({
    name: item.caseTitle || item.text?.slice(0, 40) || '测试音频',
    textContent: item.text,
    voiceCode: generationConfig.voiceType || generationConfig.voice,
    language: generationConfig.lang,
    speed: generationConfig.rate,
    pitch: generationConfig.pitch || 1,
    volume: generationConfig.volume,
    audioFormat: 'mp3',
    generationParams: {
      localCaseId: item.id,
      module: item.module,
      directory: resolveTestCaseDirectory(item),
      source: item.source || 'tts',
      voiceName: generationConfig.voiceName,
      provider: generationConfig.provider,
    },
  });

  const applyGeneratedAudio = (item, blob) => {
    if (item.audioUrl?.startsWith?.('blob:')) {
      URL.revokeObjectURL(item.audioUrl);
    }
    const audioUrl = URL.createObjectURL(blob);
    dispatch(actions.updateTestAudio({
      ...buildLocalGeneratedPatch(item, {
        serverAudioId: null,
        audioBlob: blob,
        audioUrl,
        duration: 0,
        fileSize: blob.size,
        audioFormat: blob.type?.includes('wav') ? 'wav' : 'mp3',
        generatedAt: Date.now(),
        storageError: '',
      }),
    }));
  };

  const handleGenerateOne = async (item) => {
    setGeneratingIds((current) => new Set(current).add(item.id));
    try {
      const request = createGenerationRequest(item);
      const blob = await synthesizeTestAudioBlob(request);
      applyGeneratedAudio(item, blob);
    } catch (error) {
      console.warn('Test audio generation failed:', error);
      dispatch(actions.updateTestAudio(buildLocalGeneratedPatch(item, {
        audioStatus: 'not_generated',
        audioBlob: null,
        audioUrl: null,
        storageError: error?.message || '音频生成失败',
      })));
    } finally {
      setGeneratingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleGenerateByGroup = async (groupName) => {
    const items = sortTestCasesByDirectoryOrder(sortedCases, { directory: groupName });
    for (const item of items) {
      await handleGenerateOne(item);
    }
  };

  const handleGenerateAll = async () => {
    for (const item of sortedCases) {
      await handleGenerateOne(item);
    }
  };

  const handleSaveAudio = async (item) => {
    const audioUrl = getGeneratedAudioUrl(item);
    if (!audioUrl) {
      alert('当前用例没有可保存的音频，请先生成测试音频');
      return;
    }

    setSavingIds((current) => new Set(current).add(item.id));
    try {
      const blob = item.audioBlob || await fetchStoredTestAudioBlob(audioUrl);
      await saveBlobWithPicker(blob, getAudioFilename(item));
    } catch (error) {
      if (error?.name !== 'AbortError') {
        alert(error?.message || '保存音频失败');
      }
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleSaveAllAudios = async () => {
    if (savableGeneratedAudios.length === 0) {
      alert('当前没有可保存的已生成音频');
      return;
    }

    setIsSavingAll(true);
    try {
      if (typeof window.showDirectoryPicker === 'function' && window.isSecureContext) {
        await saveGeneratedAudiosToDirectory(savableGeneratedAudios);
      } else {
        await saveGeneratedAudiosAsZip(savableGeneratedAudios);
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        alert(error?.message || '批量保存音频失败');
      }
    } finally {
      setIsSavingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-dark rounded-xl p-5 border border-gray-700 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <span className="text-2xl">🗃️</span>
            测试用例管理
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            统一管理已导入测试用例；文本导入置顶展示，TAPD 接口导入单独标记。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            文本 {textImportedCount} · TAPD {tapdImportedCount} · 已生成 {totalGenerated}/{state.testAudios.length}
          </span>
          <button
            onClick={handleGenerateAll}
            disabled={state.testAudios.length === 0 || generatingIds.size > 0}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors text-sm whitespace-nowrap"
          >
            <span>⚡</span> {generatingIds.size > 0 ? `生成中 ${generatingIds.size}` : '全部生成测试音频'}
          </button>
          <button
            onClick={handleSaveAllAudios}
            disabled={savableGeneratedAudios.length === 0 || isSavingAll}
            title={typeof window.showDirectoryPicker === 'function' && window.isSecureContext
              ? '选择目录后按功能目录保存全部音频'
              : '当前浏览器会下载包含功能目录的 zip 文件'}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors text-sm whitespace-nowrap"
          >
            <span>💾</span> {isSavingAll ? '保存中...' : `全部保存音频 (${savableGeneratedAudios.length})`}
          </button>
          <button
            onClick={handleClearCases}
            disabled={state.testAudios.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors text-sm whitespace-nowrap"
          >
            <span>🗑️</span> 清空测试用例
          </button>
          <button
            onClick={() => setShowWizard(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium transition-colors text-sm whitespace-nowrap"
          >
            <span>📋</span> TAPD 接口导入
          </button>
        </div>
      </div>

      <div className="bg-dark rounded-xl p-5 border border-gray-700">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold text-white">生成测试音频参数</h3>
            <p className="text-sm text-gray-400 mt-1">选择后点击生成，所选音色和语言会写入对应测试用例。</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="space-y-1">
              <span className="block text-xs text-gray-400">语言</span>
              <select
                value={generationLang}
                onChange={(event) => handleGenerationLangChange(event.target.value)}
                className="min-w-[160px] px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary"
              >
                {LANG_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-gray-400">音色</span>
              <select
                value={generationVoice}
                onChange={(event) => setGenerationVoice(event.target.value)}
                className="min-w-[240px] px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary"
              >
                {voiceOptions.map((voice) => (
                  <option key={voice.value} value={voice.value}>{voice.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-300">{generationConfig.voiceName}</span>
          <span className="px-2.5 py-1 rounded-full bg-gray-800 text-gray-300">{generationConfig.voiceType}</span>
          <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300">
            {LANG_OPTIONS.find((item) => item.value === generationConfig.lang)?.label || generationConfig.lang}
          </span>
        </div>
      </div>

      <div className="bg-dark rounded-xl p-5 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <span>📚</span>
            导入的测试用例列表
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">目录筛选</span>
            <select
              value={selectedDirectory}
              onChange={(e) => setSelectedDirectory(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary"
            >
              <option value="all">全部目录</option>
              {directoryOptions
                .filter((name) => name !== 'all')
                .map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
            </select>
          </div>
        </div>

        {state.testAudios.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-4xl mb-3">📭</p>
            <p>当前暂无导入用例</p>
            <p className="text-xs mt-2">从导入测试音频页导入文本，或点击右上角「TAPD 接口导入」</p>
          </div>
        ) : (
          <div className="max-h-[62vh] overflow-y-auto space-y-2 pr-1">
            {visibleCases.map((item, index) => {
              const isTextImported = isTextImportedCase(item);
              const source = item.source === 'tapd'
                ? 'TAPD'
                : isTextImported
                ? '文本导入'
                : (item.source === 'tts' ? 'TTS' : '音频文件');
              const generated = isGeneratedTestAudio(item);
              const isGenerating = generatingIds.has(item.id);
              const isSaving = savingIds.has(item.id);
              const canSaveAudio = Boolean(getGeneratedAudioUrl(item));
              const directoryName = resolveTestCaseDirectory(item);

              return (
                <div key={item.id || `${item.text}-${index}`} className="bg-darker border border-gray-700 rounded-lg p-3">
                  {index === 0 && visibleTextImportedCount > 0 && isTextImported && (
                    <div className="mb-2 text-xs font-medium text-blue-300">文本导入用例</div>
                  )}
                  {index === visibleTextImportedCount && visibleTextImportedCount > 0 && !isTextImported && (
                    <div className="mb-2 text-xs font-medium text-gray-400">TAPD / 已生成音频用例</div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-white truncate">
                      {item.caseTitle || item.text}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                        isTextImported
                          ? 'bg-blue-500/20 text-blue-300'
                          : item.source === 'tapd'
                          ? 'bg-indigo-500/20 text-indigo-300'
                          : item.source === 'tts'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-green-500/20 text-green-400'
                      }`}>
                        {source}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                        generated ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                      }`}>
                        {generated ? '已生成音频' : '未生成音频'}
                      </span>
                      <button
                        onClick={() => handleGenerateOne(item)}
                        disabled={isGenerating}
                        className="px-2 py-1 bg-primary hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs transition-colors"
                      >
                        {isGenerating ? '生成中...' : generated ? '重新生成测试音频' : '生成测试音频'}
                      </button>
                      {generated ? (
                        <button
                          onClick={() => handleSaveAudio(item)}
                          disabled={isSaving || !canSaveAudio}
                          title={getSaveAudioDisabledTitle(item)}
                          className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs transition-colors"
                        >
                          {isSaving ? '保存中...' : '保存音频'}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <p className="text-xs text-gray-300 mt-2 break-all">{item.text}</p>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>目录：{directoryName}</span>
                    <span>模块：{item.module || directoryName}</span>
                    {generated && item.config?.voiceName ? <span>音色：{item.config.voiceName}</span> : null}
                    {generated && item.config?.lang ? <span>语言：{item.config.lang}</span> : null}
                    {generated && item.fileSize ? <span>临时音频：{Math.ceil(item.fileSize / 1024)} KB</span> : null}
                    {item.storageError ? <span className="text-amber-300">保存提示：{item.storageError}</span> : null}
                    {item.workspaceName ? <span>项目：{item.workspaceName}</span> : null}
                    {item.tapdCaseId ? <span>用例ID：{item.tapdCaseId}</span> : null}
                    {item.tapdTestPlanName ? <span>计划：{item.tapdTestPlanName}</span> : null}
                  </div>
                </div>
              );
            })}
            {visibleCases.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p className="text-3xl mb-3">📁</p>
                <p>当前目录暂无用例</p>
              </div>
            )}
          </div>
        )}
      </div>

      {showWizard && <TapdImportWizard onClose={() => setShowWizard(false)} />}
    </div>
  );
}

