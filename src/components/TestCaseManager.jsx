import React, { useState } from 'react';
import TapdImportWizard from './TapdImportWizard';
import { useTest, actions } from '../stores/testStore';
import {
  resolveTestCaseDirectory,
  sortTestCasesByDirectoryOrder,
} from '../utils/testCaseOrdering';

export default function TestCaseManager() {
  const [showWizard, setShowWizard] = useState(false);
  const [selectedDirectory, setSelectedDirectory] = useState('all');
  const { state, dispatch } = useTest();

  const sortedCases = React.useMemo(() => {
    return sortTestCasesByDirectoryOrder(state.testAudios);
  }, [state.testAudios]);

  const directoryOptions = React.useMemo(() => {
    const directories = Array.from(new Set(sortedCases.map((item) => resolveTestCaseDirectory(item))));
    return ['all', ...directories];
  }, [sortedCases]);

  const visibleCases = React.useMemo(() => {
    if (selectedDirectory === 'all') {
      return sortedCases;
    }
    return sortTestCasesByDirectoryOrder(sortedCases, { directory: selectedDirectory });
  }, [sortedCases, selectedDirectory]);

  const totalGenerated = React.useMemo(() => {
    return state.testAudios.filter((item) => (item.audioStatus ? item.audioStatus === 'generated' : true)).length;
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

  const handleGenerateOne = (item) => {
    dispatch(actions.updateTestAudio({
      id: item.id,
      audioStatus: 'generated'
    }));
  };

  const handleGenerateByGroup = (groupName) => {
    const items = sortTestCasesByDirectoryOrder(sortedCases, { directory: groupName });
    items.forEach((item) => {
      if (item.audioStatus !== 'generated') {
        dispatch(actions.updateTestAudio({
          id: item.id,
          audioStatus: 'generated'
        }));
      }
    });
  };

  const handleGenerateAll = () => {
    sortedCases.forEach((item) => {
      if (item.audioStatus !== 'generated') {
        dispatch(actions.updateTestAudio({
          id: item.id,
          audioStatus: 'generated'
        }));
      }
    });
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
            统一管理已导入测试用例，按用例目录分组展示；点击“生成测试音频”后才进入语音测试可测列表。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">已生成 {totalGenerated}/{state.testAudios.length}</span>
          <button
            onClick={handleGenerateAll}
            disabled={totalGenerated === state.testAudios.length || state.testAudios.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors text-sm whitespace-nowrap"
          >
            <span>⚡</span> 全部生成测试音频
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
            <p className="text-xs mt-2">点击右上角「TAPD 接口导入」后将显示在这里</p>
          </div>
        ) : (
          <div className="max-h-[62vh] overflow-y-auto space-y-2 pr-1">
            {visibleCases.map((item, index) => {
              const source = item.source === 'tapd' ? 'TAPD' : (item.source === 'tts' ? 'TTS' : '文件');
              const generated = item.audioStatus ? item.audioStatus === 'generated' : true;
              const directoryName = resolveTestCaseDirectory(item);

              return (
                <div key={item.id || `${item.text}-${index}`} className="bg-darker border border-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-white truncate">
                      {item.caseTitle || item.text}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                        item.source === 'tapd'
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
                        disabled={generated}
                        className="px-2 py-1 bg-primary hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs transition-colors"
                      >
                        生成测试音频
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-gray-300 mt-2 break-all">{item.text}</p>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>目录：{directoryName}</span>
                    <span>模块：{item.module || directoryName}</span>
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

