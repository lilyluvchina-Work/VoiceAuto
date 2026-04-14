/**
 * VoiceAuto - 语音自动化测试平台
 * 主应用组件
 */
import React, { useState } from 'react';
import { TestProvider, useTest } from './stores/testStore';
import WakeWordConfig from './components/WakeWordConfig';
import VoiceConfig from './components/VoiceConfig';
import AudioImporter from './components/AudioImporter';
import AudioList from './components/AudioList';
import PlaybackConsole from './components/PlaybackConsole';
import TestReport from './components/TestReport';
import LogAnalyzer from './components/LogAnalyzer';

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

function AppContent() {
  const { state } = useTest();
  const [showReport, setShowReport] = useState(false);
  const [activeMode, setActiveMode] = useState('voice');

  const handleTestComplete = () => {
    setShowReport(true);
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
                <button
                  onClick={() => setActiveMode('voice')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    activeMode === 'voice'
                      ? 'bg-primary text-white'
                      : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  语音测试
                </button>
                <button
                  onClick={() => {
                    setActiveMode('log');
                    setShowReport(false);
                  }}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    activeMode === 'log'
                      ? 'bg-primary text-white'
                      : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  日志分析
                </button>
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

              {/* 显示报告按钮 */}
              {activeMode === 'voice' && state.report.cases.length > 0 && (
                <button
                  onClick={() => setShowReport(!showReport)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    showReport
                      ? 'bg-primary text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  📊 {showReport ? '收起报告' : '查看报告'}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeMode === 'log' ? (
          <LogAnalyzer />
        ) : showReport && state.report.cases.length > 0 ? (
          // 报告视图
          <div className="max-w-3xl mx-auto">
            <TestReport />
          </div>
        ) : (
          // 编辑视图
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 左侧：唤醒词 + 音频配置 */}
            <div className="space-y-6">
              <WakeWordConfig />
              <VoiceConfig />
            </div>

            {/* 右侧：导入 + 列表 + 控制台 */}
            <div className="space-y-6">
              <AudioImporter />
              <AudioList />
              <PlaybackConsole onTestComplete={handleTestComplete} />
            </div>
          </div>
        )}
      </main>

      {/* 页脚 */}
      <footer className="border-t border-gray-800 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between text-sm text-gray-500">
            <div>
              VoiceAuto v1.0 - 语音自动化测试平台
            </div>
            <div className="flex items-center gap-4">
              {activeMode === 'voice' ? (
                <>
                  <span>🔔 唤醒词: {state.wakeWord.text}</span>
                  <span>📋 {state.testAudios.length} 条音频</span>
                </>
              ) : (
                <span>🧾 日志分析模式</span>
              )}
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
