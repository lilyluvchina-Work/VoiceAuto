/**
 * VoiceAuto - 语音自动化测试平台
 * 主应用组件
 */
import React, { useEffect, useRef, useState } from 'react';
import { TestProvider, useTest, actions } from './stores/testStore';
import AudioImporter from './components/AudioImporter';
import AudioList from './components/AudioList';
import PlaybackConsole from './components/PlaybackConsole';
import TestProcessRecord from './components/TestProcessRecord';
import LangfuseFetcher from './components/LangfuseFetcher';
import TestCaseManager from './components/TestCaseManager';
import SummaryReport from './components/SummaryReport';
import ConfigCenter from './components/ConfigCenter';
import { AuthGate, useAuth } from './components/AuthGate';
import { getDefaultLangfuseEnvironmentKey } from './modules/langfuse/services/langfuseService';
import { APP_VERSION } from './constants';
import { recordToolUsage } from './utils/toolUsageStore';
import { downloadAiToySerialLog } from './services/adbWakeService';

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
  audio: 'audio',
  report: 'report',
  summary: 'summary',
  langfuse: 'langfuse',
  config: 'config',
};

const TAB_ITEMS = [
  { key: MODES.cases, icon: '🗃️', label: '测试用例管理' },
  { key: MODES.audio, icon: '🎧', label: '测试音频' },
  { key: MODES.voice, icon: '🎙️', label: '语音控制' },
  { key: MODES.report, icon: '📊', label: '测试过程记录' },
  { key: MODES.langfuse, icon: '🗂️', label: 'Langfuse 日志' },
  { key: MODES.summary, icon: '🧾', label: '总结报告' },
  { key: MODES.config, icon: '⚙️', label: '配置中心' },
];

function AppContent() {
  const { state, dispatch } = useTest();
  const auth = useAuth();
  const [activeMode, setActiveMode] = useState(MODES.cases);
  const [pendingLangfuseJump, setPendingLangfuseJump] = useState(false);
  const [serialLogDownloadError, setSerialLogDownloadError] = useState('');
  const aiToySerialLog = state.report?.aiToySerialLog;
  const autoJumpTimerRef = useRef(null);
  const recordedUsageIdsRef = useRef(new Set());
  const isTesting = state.playback.isPlaying || state.playback.isPaused;
  const shouldAutoFetchLangfuseLogs = Boolean(state.testOptions?.autoFetchLangfuseLogs ?? true);
  const selectedLangfuseEnv = state.testOptions?.selectedLangfuseEnv || getDefaultLangfuseEnvironmentKey();

  useEffect(() => () => {
    if (autoJumpTimerRef.current) {
      window.clearTimeout(autoJumpTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const onOpenConfig = () => setActiveMode(MODES.config);
    window.addEventListener('voiceauto:open-config-type', onOpenConfig);
    return () => window.removeEventListener('voiceauto:open-config-type', onOpenConfig);
  }, []);

  useEffect(() => {
    if (!autoJumpTimerRef.current) return;
    if (!shouldAutoFetchLangfuseLogs || state.playback.status === 'playing') {
      window.clearTimeout(autoJumpTimerRef.current);
      autoJumpTimerRef.current = null;
      setPendingLangfuseJump(false);
    }
  }, [shouldAutoFetchLangfuseLogs, state.playback.status]);

  useEffect(() => {
    const startTime = state.report?.startTime;
    const endTime = state.report?.endTime;
    const loginAccount = auth?.currentUser?.loginAccount;
    if (!startTime || !endTime || !loginAccount) return;

    const usageId = [
      state.report?.runId || 'run',
      loginAccount,
      startTime,
      endTime,
    ].join('|');
    if (recordedUsageIdsRef.current.has(usageId)) return;
    const record = recordToolUsage({
      runId: state.report?.runId,
      startTime,
      endTime,
      user: auth.currentUser,
    });
    if (record) recordedUsageIdsRef.current.add(usageId);
  }, [auth?.currentUser, state.report?.endTime, state.report?.runId, state.report?.startTime]);

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

  useEffect(() => {
    setSerialLogDownloadError('');
  }, [aiToySerialLog]);

  const handleDownloadSerialLog = () => {
    try {
      downloadAiToySerialLog(aiToySerialLog);
      setSerialLogDownloadError('');
    } catch (error) {
      setSerialLogDownloadError(`串口日志下载失败，请重试：${error.message}`);
    }
  };

  const renderMainContent = () => {
    return (
      <div className="space-y-6">
        {aiToySerialLog && (
          <div className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-blue-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="status">
                <p>AI玩具测试已结束，请下载本次串口日志。</p>
                <p className="mt-1 text-xs text-gray-400">刷新页面、重置或开始下一次测试前，请先下载保存。</p>
              </div>
              <button type="button" onClick={handleDownloadSerialLog}
                className="rounded-lg bg-primary px-4 py-2 font-medium text-white hover:bg-primary/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                下载串口日志
              </button>
            </div>
            {serialLogDownloadError && <p role="alert" className="mt-2 text-red-300">{serialLogDownloadError}</p>}
          </div>
        )}
        {/* 保持挂载：切换左侧菜单时只隐藏页面，避免已展示数据或编辑内容被重置 */}
        <div className={activeMode === MODES.langfuse ? 'block' : 'hidden'}>
          <LangfuseFetcher />
        </div>

        <div className={activeMode === MODES.cases ? 'block' : 'hidden'}>
          <TestCaseManager />
        </div>

        <div className={activeMode === MODES.audio ? 'block' : 'hidden'}>
          <div className="mx-auto max-w-6xl space-y-6">
            <AudioImporter />
            <AudioList />
          </div>
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

        <div className={activeMode === MODES.config ? 'block' : 'hidden'}>
          <ConfigCenter />
        </div>

        <div className={activeMode === MODES.voice ? 'block' : 'hidden'}>
          <div className="space-y-6">
            {pendingLangfuseJump && (
              <div className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-blue-100">
                测试已完成，将在当前页面停留 2 分钟后跳转到 Langfuse 日志，并拉取所选环境日志。测试音频会保留，可用于下次继续测试。
              </div>
            )}

            <PlaybackConsole onTestComplete={handleTestComplete} />
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

    if (activeMode === MODES.audio) {
      return <span>🎧 测试音频模式</span>;
    }

    if (activeMode === MODES.config) {
      return <span>⚙️ 配置中心模式</span>;
    }

    return <span>🗂️ Langfuse 日志模式</span>;
  };

  return (
    <div className="min-h-screen bg-darker pl-16 md:pl-56">
      <aside className="fixed inset-y-0 left-0 z-50 flex w-16 flex-col border-r border-gray-800 bg-dark md:w-56">
        <div className="flex h-20 shrink-0 items-center justify-center border-b border-gray-800 px-3 md:justify-start md:px-5">
          <span className="text-primary"><Logo /></span>
          <span className="ml-3 hidden text-lg font-bold text-white md:block">VoiceAuto</span>
        </div>
        <nav aria-label="主菜单" className="flex-1 space-y-2 overflow-y-auto px-2 py-5 md:px-3">
          {TAB_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveMode(item.key)}
              aria-current={activeMode === item.key ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              className={`flex min-h-11 w-full items-center justify-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:justify-start ${
                activeMode === item.key
                  ? 'bg-primary text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <span aria-hidden="true" className="shrink-0 text-lg">{item.icon}</span>
              <span className="hidden md:block">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      {/* 顶部信息栏 */}
      <header className="bg-dark border-b border-gray-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-xl font-bold text-white">{TAB_ITEMS.find(item => item.key === activeMode)?.label}</h1>
                <p className="text-xs text-gray-400">语音自动化测试平台 · 版本号：{APP_VERSION}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
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

              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-full">
                <span className="text-xs text-gray-300">{auth?.currentUser?.username}</span>
                <button
                  onClick={auth?.logout}
                  className="text-xs text-gray-500 hover:text-gray-200 transition-colors"
                >
                  退出
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="min-w-0 max-w-7xl mx-auto px-4 py-6 lg:px-6">
        {renderMainContent()}
      </main>

      {/* 页脚 */}
      <footer className="border-t border-gray-800 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500">
            <div>
              VoiceAuto - 语音自动化测试平台 · 版本号：{APP_VERSION}
            </div>
            <div className="flex flex-wrap items-center gap-3">
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
    <AuthGate>
      <TestProvider>
        <AppContent />
      </TestProvider>
    </AuthGate>
  );
}

export default App;
