/**
 * 测试状态管理
 * 使用 React Context 实现全局状态管理
 */

import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { generateId } from '../utils/formatters';

const STORAGE_KEY = 'voiceauto_state';

const shouldKeepImportedCaseAfterAudioDelete = (audio) => {
  return audio?.source === 'tapd' || Boolean(audio?.tapdCaseId || audio?.tapdTestPlanId);
};

// 初始状态
const initialState = {
  // 唤醒词配置
  wakeWord: {
    text: 'Hey, Cedar',
    wakeAfterDelay: 1000,    // 唤醒后延迟 (ms)
    wakeIntervalDelay: 20000, // 唤醒间延迟 (ms)
    audioBlob: null,
    audioUrl: null
  },

  // 音频配置（默认值）
  defaultVoiceConfig: {
    voice: 'xiaoxiao',
    voiceName: '晓晓',
    lang: 'zh-CN',
    dialect: '普通话',
    volume: 100,
    rate: 1.0
  },

  // 测试音频列表
  testAudios: [],

  // 测试选项
  testOptions: {
    loopCount: 1,
    debugSequence: false,
    autoFetchLangfuseLogs: true,
    selectedLangfuseEnv: 'UAT',
    selectedTestModule: 'all'
  },

  // 当前播放状态
  playback: {
    isPlaying: false,
    isPaused: false,
    currentIndex: -1,
    currentListIndex: -1,
    currentType: null, // 'wake' | 'test'
    status: 'idle', // 'idle' | 'playing' | 'paused' | 'completed'
    startTime: null,
    elapsedTime: 0
  },

  // 测试报告
  report: {
    runId: '',
    startTime: null,
    endTime: null,
    firstTestAudioTime: null,
    lastTestAudioTime: null,
    langfuseFetchEndTime: null,
    langfuseAutoFetchRequestedAt: null,
    langfuseEnvKey: 'UAT',
    successCount: 0,
    failCount: 0,
    cases: []
  }
};

// Action 类型
const ActionTypes = {
  SET_WAKE_WORD: 'SET_WAKE_WORD',
  SET_WAKE_DELAY: 'SET_WAKE_DELAY',
  SET_WAKE_INTERVAL_DELAY: 'SET_WAKE_INTERVAL_DELAY',
  SET_WAKE_AUDIO: 'SET_WAKE_AUDIO',
  SET_VOICE_CONFIG: 'SET_VOICE_CONFIG',
  ADD_TEST_AUDIO: 'ADD_TEST_AUDIO',
  REMOVE_TEST_AUDIO: 'REMOVE_TEST_AUDIO',
  CLEAR_TEST_AUDIOS: 'CLEAR_TEST_AUDIOS',
  UPDATE_TEST_AUDIO: 'UPDATE_TEST_AUDIO',
  REORDER_TEST_AUDIOS: 'REORDER_TEST_AUDIOS',
  SET_LOOP_COUNT: 'SET_LOOP_COUNT',
  SET_DEBUG_SEQUENCE: 'SET_DEBUG_SEQUENCE',
  SET_AUTO_FETCH_LANGFUSE_LOGS: 'SET_AUTO_FETCH_LANGFUSE_LOGS',
  SET_SELECTED_LANGFUSE_ENV: 'SET_SELECTED_LANGFUSE_ENV',
  SET_SELECTED_TEST_MODULE: 'SET_SELECTED_TEST_MODULE',
  SET_PLAYBACK_STATE: 'SET_PLAYBACK_STATE',
  START_PLAYBACK: 'START_PLAYBACK',
  PAUSE_PLAYBACK: 'PAUSE_PLAYBACK',
  STOP_PLAYBACK: 'STOP_PLAYBACK',
  UPDATE_ELAPSED_TIME: 'UPDATE_ELAPSED_TIME',
  SET_REPORT: 'SET_REPORT',
  ADD_REPORT_CASE: 'ADD_REPORT_CASE',
  COMPLETE_REPORT: 'COMPLETE_REPORT',
  RESET_TEST: 'RESET_TEST'
};

// Reducer
function testReducer(state, action) {
  switch (action.type) {
    case ActionTypes.SET_WAKE_WORD:
      return {
        ...state,
        wakeWord: { ...state.wakeWord, text: action.payload }
      };

    case ActionTypes.SET_WAKE_DELAY:
      return {
        ...state,
        wakeWord: { ...state.wakeWord, wakeAfterDelay: action.payload }
      };

    case ActionTypes.SET_WAKE_INTERVAL_DELAY:
      return {
        ...state,
        wakeWord: { ...state.wakeWord, wakeIntervalDelay: action.payload }
      };

    case ActionTypes.SET_WAKE_AUDIO:
      return {
        ...state,
        wakeWord: {
          ...state.wakeWord,
          audioBlob: action.payload.blob,
          audioUrl: action.payload.url
        }
      };

    case ActionTypes.SET_VOICE_CONFIG:
      return {
        ...state,
        defaultVoiceConfig: { ...state.defaultVoiceConfig, ...action.payload }
      };

    case ActionTypes.ADD_TEST_AUDIO:
      return {
        ...state,
        testAudios: [...state.testAudios, action.payload]
      };

    case ActionTypes.REMOVE_TEST_AUDIO:
      return {
        ...state,
        testAudios: state.testAudios.flatMap(a => {
          if (a.id !== action.payload) {
            return [a];
          }

          if (!shouldKeepImportedCaseAfterAudioDelete(a)) {
            return [];
          }

          return [{
            ...a,
            audioStatus: 'not_generated',
            audioBlob: null,
            audioUrl: null,
            duration: 0
          }];
        }),
        playback: state.playback.currentAudioId === action.payload
          ? {
              ...state.playback,
              currentAudioId: null,
              currentListIndex: -1,
              currentIndex: -1,
              currentType: null
            }
          : state.playback
      };

    case ActionTypes.CLEAR_TEST_AUDIOS:
      return {
        ...state,
        testAudios: []
      };

    case ActionTypes.UPDATE_TEST_AUDIO:
      return {
        ...state,
        testAudios: state.testAudios.map(a =>
          a.id === action.payload.id ? { ...a, ...action.payload } : a
        )
      };

    case ActionTypes.REORDER_TEST_AUDIOS:
      return {
        ...state,
        testAudios: action.payload
      };

    case ActionTypes.SET_LOOP_COUNT:
      return {
        ...state,
        testOptions: {
          ...state.testOptions,
          loopCount: Math.max(1, Math.min(99, action.payload))
        }
      };

    case ActionTypes.SET_DEBUG_SEQUENCE:
      return {
        ...state,
        testOptions: {
          ...state.testOptions,
          debugSequence: Boolean(action.payload)
        }
      };

    case ActionTypes.SET_AUTO_FETCH_LANGFUSE_LOGS:
      return {
        ...state,
        testOptions: {
          ...state.testOptions,
          autoFetchLangfuseLogs: Boolean(action.payload)
        }
      };

    case ActionTypes.SET_SELECTED_LANGFUSE_ENV:
      return {
        ...state,
        testOptions: {
          ...state.testOptions,
          selectedLangfuseEnv: action.payload || 'UAT'
        }
      };

    case ActionTypes.SET_SELECTED_TEST_MODULE:
      return {
        ...state,
        testOptions: {
          ...state.testOptions,
          selectedTestModule: action.payload || 'all'
        }
      };

    case ActionTypes.SET_PLAYBACK_STATE:
      return {
        ...state,
        playback: { ...state.playback, ...action.payload }
      };

    case ActionTypes.START_PLAYBACK:
      const playbackStartTime = Date.now();
      return {
        ...state,
        playback: {
          ...state.playback,
          isPlaying: true,
          isPaused: false,
          status: 'playing',
          startTime: playbackStartTime
        },
        report: {
          ...state.report,
          runId: action.payload?.runId || '',
          startTime: playbackStartTime,
          endTime: null,
          firstTestAudioTime: null,
          lastTestAudioTime: null,
          langfuseFetchEndTime: null,
          langfuseAutoFetchRequestedAt: null,
          langfuseEnvKey: state.testOptions.selectedLangfuseEnv || 'UAT',
          successCount: 0,
          failCount: 0,
          cases: []
        }
      };

    case ActionTypes.PAUSE_PLAYBACK:
      return {
        ...state,
        playback: {
          ...state.playback,
          isPlaying: false,
          isPaused: true,
          status: 'paused'
        }
      };

    case ActionTypes.STOP_PLAYBACK:
      return {
        ...state,
        playback: initialState.playback,
        report: {
          ...state.report,
          endTime: Date.now()
        }
      };

    case ActionTypes.UPDATE_ELAPSED_TIME:
      return {
        ...state,
        playback: { ...state.playback, elapsedTime: action.payload }
      };

    case ActionTypes.SET_REPORT:
      return {
        ...state,
        report: { ...state.report, ...action.payload }
      };

    case ActionTypes.ADD_REPORT_CASE:
      return {
        ...state,
        report: {
          ...state.report,
          cases: [...state.report.cases, action.payload],
          successCount: action.payload.success
            ? state.report.successCount + 1
            : state.report.successCount,
          failCount: action.payload.success
            ? state.report.failCount
            : state.report.failCount + 1
        }
      };

    case ActionTypes.COMPLETE_REPORT:
      return {
        ...state,
        playback: {
          ...state.playback,
          isPlaying: false,
          isPaused: false,
          status: 'completed'
        },
        report: {
          ...state.report,
          endTime: Date.now()
        }
      };

    case ActionTypes.RESET_TEST:
      return {
        ...state,
        playback: initialState.playback,
        report: initialState.report
      };

    default:
      return state;
  }
}

// Context
const TestContext = createContext(null);

// Provider 组件
export function TestProvider({ children }) {
  const [state, dispatch] = useReducer(testReducer, initialState, (init) => {
    // 从 localStorage 恢复状态
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...init,
          wakeWord: {
            ...init.wakeWord,
            text: parsed.wakeWord?.text || init.wakeWord.text,
            wakeAfterDelay: parsed.wakeWord?.wakeAfterDelay || init.wakeWord.wakeAfterDelay,
            wakeIntervalDelay: Math.max(
              parsed.wakeWord?.wakeIntervalDelay || init.wakeWord.wakeIntervalDelay,
              20000
            )
          },
          defaultVoiceConfig: {
            ...init.defaultVoiceConfig,
            ...parsed.defaultVoiceConfig
          },
          testAudios: parsed.testAudios || [],
          testOptions: {
            ...init.testOptions,
            loopCount: Math.max(1, Math.min(99, parsed.testOptions?.loopCount || init.testOptions.loopCount)),
            debugSequence: Boolean(parsed.testOptions?.debugSequence),
            autoFetchLangfuseLogs: parsed.testOptions?.autoFetchLangfuseLogs !== false,
            selectedLangfuseEnv: parsed.testOptions?.selectedLangfuseEnv || 'UAT',
            selectedTestModule: parsed.testOptions?.selectedTestModule || 'all'
          }
        };
      }
    } catch (e) {
      console.warn('Failed to restore state from localStorage');
    }
    return init;
  });

  // 保存状态到 localStorage
  useEffect(() => {
    const serializedAudios = state.testAudios.map((audio) => {
      const {
        audioBlob,
        originalFile,
        audioUrl,
        ...rest
      } = audio;

      return {
        ...rest,
        // Blob/File 不能可靠持久化；文件音频 URL 刷新后也可能失效
        audioBlob: null,
        audioUrl: audio.source === 'file' ? null : (audioUrl || null),
      };
    });

    const toSave = {
      wakeWord: {
        text: state.wakeWord.text,
        wakeAfterDelay: state.wakeWord.wakeAfterDelay,
        wakeIntervalDelay: state.wakeWord.wakeIntervalDelay
      },
      defaultVoiceConfig: state.defaultVoiceConfig,
      testOptions: state.testOptions,
      // 持久化完整可序列化字段，避免 TAPD 导入元数据刷新后丢失
      testAudios: serializedAudios
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }, [state.wakeWord, state.defaultVoiceConfig, state.testOptions, state.testAudios]);

  return (
    <TestContext.Provider value={{ state, dispatch, ActionTypes }}>
      {children}
    </TestContext.Provider>
  );
}

// Hook
export function useTest() {
  const context = useContext(TestContext);
  if (!context) {
    throw new Error('useTest must be used within TestProvider');
  }
  return context;
}

// Action creators
export const actions = {
  setWakeWord: (text) => ({
    type: ActionTypes.SET_WAKE_WORD,
    payload: text
  }),

  setWakeDelay: (delay) => ({
    type: ActionTypes.SET_WAKE_DELAY,
    payload: delay
  }),

  setWakeIntervalDelay: (delay) => ({
    type: ActionTypes.SET_WAKE_INTERVAL_DELAY,
    payload: delay
  }),

  setWakeAudio: (blob, url) => ({
    type: ActionTypes.SET_WAKE_AUDIO,
    payload: { blob, url }
  }),

  setVoiceConfig: (config) => ({
    type: ActionTypes.SET_VOICE_CONFIG,
    payload: config
  }),

  addTestAudio: (audio) => ({
    type: ActionTypes.ADD_TEST_AUDIO,
    payload: { id: generateId(), ...audio }
  }),

  removeTestAudio: (id) => ({
    type: ActionTypes.REMOVE_TEST_AUDIO,
    payload: id
  }),

  clearTestAudios: () => ({
    type: ActionTypes.CLEAR_TEST_AUDIOS
  }),

  updateTestAudio: (audio) => ({
    type: ActionTypes.UPDATE_TEST_AUDIO,
    payload: audio
  }),

  reorderTestAudios: (audios) => ({
    type: ActionTypes.REORDER_TEST_AUDIOS,
    payload: audios
  }),

  setLoopCount: (count) => ({
    type: ActionTypes.SET_LOOP_COUNT,
    payload: count
  }),

  setDebugSequence: (enabled) => ({
    type: ActionTypes.SET_DEBUG_SEQUENCE,
    payload: enabled
  }),

  setAutoFetchLangfuseLogs: (enabled) => ({
    type: ActionTypes.SET_AUTO_FETCH_LANGFUSE_LOGS,
    payload: enabled
  }),

  setSelectedLangfuseEnv: (envKey) => ({
    type: ActionTypes.SET_SELECTED_LANGFUSE_ENV,
    payload: envKey
  }),

  setSelectedTestModule: (moduleName) => ({
    type: ActionTypes.SET_SELECTED_TEST_MODULE,
    payload: moduleName
  }),

  setPlaybackState: (state) => ({
    type: ActionTypes.SET_PLAYBACK_STATE,
    payload: state
  }),

  startPlayback: (runId) => ({
    type: ActionTypes.START_PLAYBACK,
    payload: { runId }
  }),

  pausePlayback: () => ({
    type: ActionTypes.PAUSE_PLAYBACK
  }),

  stopPlayback: () => ({
    type: ActionTypes.STOP_PLAYBACK
  }),

  updateElapsedTime: (time) => ({
    type: ActionTypes.UPDATE_ELAPSED_TIME,
    payload: time
  }),

  addReportCase: (caseData) => ({
    type: ActionTypes.ADD_REPORT_CASE,
    payload: caseData
  }),

  setReport: (reportPatch) => ({
    type: ActionTypes.SET_REPORT,
    payload: reportPatch
  }),

  completeReport: () => ({
    type: ActionTypes.COMPLETE_REPORT
  }),

  resetTest: () => ({
    type: ActionTypes.RESET_TEST
  })
};
