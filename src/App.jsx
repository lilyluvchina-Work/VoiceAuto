/**
 * VoiceAuto - 语音自动化测试平台
 * 主应用组件
 */
import React, { useEffect, useRef, useState } from 'react';
import { TestProvider, useTest, actions } from './stores/testStore';
import VoiceConfig from './components/VoiceConfig';
import AudioImporter from './components/AudioImporter';
import AudioList from './components/AudioList';
import PlaybackConsole from './components/PlaybackConsole';
import TestProcessRecord from './components/TestProcessRecord';
import LangfuseFetcher from './components/LangfuseFetcher';
import TestCaseManager from './components/TestCaseManager';
import SummaryReport from './components/SummaryReport';

// Logo SVG
const Logo = () => (
  <svg viewBox="0 0 40 40" className="w-10 h-10" fill="none">
    <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="2" />
    <path
      d="M20 10 L20 20 L28 20"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="20" cy="20" r="3" fill="currentColor" />
  </svg>
);

const MODES = {
  voice: 'voice',
  cases: 'cases',
  report: 'report',
  summary: 'summary',
  langfuse: 'langfuse',
};

const TAB_ITEMS = [
  { key: MODES.cases, icon: '🗃️', label: '测试用例管理' },
  { key: MODES.voice, icon: '🎙️', label: '语音测试' },
  { key: MODES.report, icon: '📊', label: '测试过程记录' },
  { key: MODES.langfuse, icon: '🗂️', label: 'Langfuse 日志' },
  { key: MODES.summary, icon: '🧾', label: '总结报告' },
];

function AppContent() {
  const { state, dispatch } = useTest();
  const [activeMode, setActiveMode] = useState(MODES.cases);
  const [pendingLangfuseJump, setPendingLangfuseJump] = useState(false);
  const autoJumpTimerRef = useRef(null);
  const isTesting = state.playback.isPlaying || state.playback.isPaused;
  const shouldAutoFetchLangfuseLogs = Boolean(state.testOptions?.autoFetchLangfuseLogs ?? true);
  const selectedLangfuseEnv = state.testOptions?.selectedLangfuseEnv || 'UAT';

  useEffect(() => () => {
    if (autoJumpTimerRef.current) {
      window.clearTimeout(autoJumpTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!autoJumpTimerRef.current) return;
    if (!shouldAutoFetchLangfuseLogs || state.playback.status === 'playing') {
      window.clearTimeout(autoJumpTimerRef.current);
      autoJumpTimerRef.current = null;
      setPendingLangfuseJump(false);
    }
  }, [shouldAutoFetchLangfuseLogs, state.playback.status]);

  const handleTestComplete = () => {
    if (autoJumpTimerRef.current) {
      window.clearTimeout(autoJumpTimerRef.current);
      autoJumpTimerRef.current = null;
    }

    if (shouldAutoFetchLangfuseLogs) {
      setActiveMode(MODES.voice);
      setPendingLangfuseJump(true);
      autoJumpTimerRef.current = window.setTimeout(() => {
        const jumpTime = Date.now();
        dispatch(actions.setReport({
          langfuseFetchEndTime: jumpTime,
          langfuseAutoFetchRequestedAt: jumpTime,
          langfuseEnvKey: selectedLangfuseEnv,
        }));
        setPendingLangfuseJump(false);
        setActiveMode(MODES.langfuse);
        autoJumpTimerRef.current = null;
      }, 2 * 60 * 1000);
      return;
    }

    setPendingLangfuseJump(false);
    setActiveMode(MODES.voice);
  };

  const renderMainContent = () => {
    return (
      <div className="space-y-6">
        {/* 保持挂载：切换顶部菜单时只隐藏页面，避免已展示数据或编辑内容被重置 */}
        <div className={activeMode === MODES.langfuse ? 'block' : 'hidden'}>
          <LangfuseFetcher />
        </div>

        <div className={activeMode === MODES.cases ? 'block' : 'hidden'}>
          <TestCaseManager />
        </div>

        <div className={activeMode === MODES.report ? 'block' : 'hidden'}>
          <div className="max-w-6xl mx-auto space-y-4">
            <TestProcessRecord />
            <p className="text-xs text-gray-500 text-center">
              {isTesting ? '测试进行中：测试过程记录会持续刷新。' : '当前为测试过程记录视图。'}
            </p>
          </div>
        </div>

        <div className={activeMode === MODES.summary ? 'block' : 'hidden'}>
          <SummaryReport />
        </div>

        <div className={activeMode === MODES.voice ? 'block' : 'hidden'}>
          <div className="space-y-6">
            {pendingLangfuseJump && (
              <div className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-blue-100">
                测试已完成，将在当前页面停留 2 分钟后跳转到 Langfuse 日志，并拉取所选环境日志。
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(560px,1fr)]">
              <section className="min-w-0">
                <PlaybackConsole onTestComplete={handleTestComplete} />
              </section>

              <section className="min-w-0 space-y-6">
                <AudioImporter />
                <AudioList />
              </section>
            </div>

            <section className="grid grid-cols-1 gap-6">
              <VoiceConfig />
            </section>
          </div>
        </div>
      </div>
    );
  };

  const renderFooterModeText = () => {
    if (activeMode === MODES.voice) {
      return (
        <>
          <span>🔔 唤醒词: {state.wakeWord.text}</span>
          <span>📋 {state.testAudios.length} 条音频</span>
        </>
      );
    }

    if (activeMode === MODES.report) {
      return <span>📊 测试过程记录模式</span>;
    }

    if (activeMode === MODES.summary) {
      return <span>🧾 总结报告模式</span>;
    }

    if (activeMode === MODES.cases) {
      return <span>🗃️ 测试用例管理模式</span>;
    }

    return <span>🗂️ Langfuse 日志模式</span>;
  };

  return (
    <div className="min-h-screen bg-darker">
      {/* 顶部导航 */}
      <header className="bg-dark border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-primary">
                <Logo />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">VoiceAuto</h1>
                <p className="text-xs text-gray-400">语音自动化测试平台</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 p-1 bg-gray-800 rounded-lg">
                {TAB_ITEMS.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setActiveMode(item.key)}
                    className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 ${
                      activeMode === item.key
                        ? 'bg-primary text-white'
                        : 'text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

              {/* 状态指示 */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-full">
                <span className={`w-2 h-2 rounded-full ${
                  state.testAudios.length > 0 ? 'bg-accent' : 'bg-gray-500'
                }`}></span>
                <span className="text-xs text-gray-400">
                  {state.testAudios.length > 0
                    ? `${state.testAudios.length} 条测试音频`
                    : '未添加音频'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {renderMainContent()}
      </main>

      {/* 页脚 */}
      <footer className="border-t border-gray-800 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between text-sm text-gray-500">
            <div>
              VoiceAuto v1.0 - 语音自动化测试平台
            </div>
            <div className="flex items-center gap-4">
              {renderFooterModeText()}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function App() {
  return (
    <TestProvider>
      <AppContent />
    </TestProvider>
  );
}

export default App;
