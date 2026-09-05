/**
 * 测试状态管理
 * 使用 React Context 实现全局状态管理
 */

import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { generateId } from '../utils/formatters';
import { getDefaultLangfuseEnvironmentKey } from '../modules/langfuse/services/langfuseService';
import { sanitizePersistedVoiceAutoState } from './stateSanitizer';
import { normalizeVoiceConfigByLang } from '../constants';
import {
  DEFAULT_AGENT_EVALUATION_METRICS,
  normalizeSelectedEvaluationMetrics,
} from '../utils/agentEvaluation';
import {
  DEVICE_TYPES,
  LOG_SOURCES,
  getDefaultDeviceOptions,
} from '../config/deviceProfiles';

const STORAGE_KEY = 'voiceauto_state';
const DEFAULT_LANGFUSE_ENV_KEY = getDefaultLangfuseEnvironmentKey();

const shouldKeepImportedCaseAfterAudioDelete = (audio) => {
  return audio?.source === 'tapd' || Boolean(audio?.tapdCaseId || audio?.tapdTestPlanId);
};

function createProcessLogSignature(log) {
  const {
    id,
    time,
    raw,
    sampleLines,
    ...rest
  } = log || {};
  return JSON.stringify(rest);
}

function mergeConfigLines(value, additions) {
  const existing = String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const existingSet = new Set(existing);
  const merged = [...existing];
  (additions || []).forEach((item) => {
    const text = String(item || '').trim();
    if (text && !existingSet.has(text)) {
      existingSet.add(text);
      merged.push(text);
    }
  });
  return merged.join('\n');
}

const CLOUD_ASR_START_KEYWORD = '/onHandlerCloudMsg==>GoogleLiveResponseBean.*messageType=asr_status/i';
const CLOUD_ASR_END_KEYWORD = '/onHandlerCloudMsg==>GoogleLiveResponseBean.*messageType=input_text/i';
const CLOUD_ASR_TEXT_PATTERN = '/message=Message\\(content=([\\s\\S]*?),\\s*messageType=(?:asr_status|input_text)\\)/i';

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
  defaultVoiceConfig: normalizeVoiceConfigByLang({
    lang: 'zh-CN',
    dialect: '普通话',
    volume: 100,
    rate: 1.0
  }),

  // 测试音频列表
  testAudios: [],

  // 测试选项
  testOptions: {
    loopCount: 1,
    debugSequence: false,
    dingTalkEnabled: false,
    autoFetchLangfuseLogs: true,
    selectedLangfuseEnv: DEFAULT_LANGFUSE_ENV_KEY,
    selectedTestModule: 'all',
    device: {
      ...getDefaultDeviceOptions(),
    },
    autonomousWake: {
      enabled: false,
      bridgeUrl: 'http://127.0.0.1:17321',
      deviceId: '',
      detectionTimeoutMs: 5000,
      failureThreshold: 5,
      recoveryTimeoutMs: 180000,
      maxRebootsPerCase: 1,
      maxRebootsPerRun: 3,
      keywords: [
        'WakeupSuccess',
        'WAKEUP_SUCCESS',
        'wakeup success',
        'onCedarWakeup',
        'GlobalControl: onCedarWakeup'
      ].join('\n')
    },
    autonomousInput: {
      enabled: false,
      asrDetectionTimeoutMs: 8000,
      asrSimilarityThreshold: 0.8,
      asrStartKeywords: [
        '/ASR_STATUS.*PARTIAL/i',
        '/asr_status[^\\n]*(partial)/i',
        '/"asr_status"\\s*:\\s*"partial"/i',
        CLOUD_ASR_START_KEYWORD
      ].join('\n'),
      asrEndKeywords: [
        '/ASR_STATUS.*FINAL/i',
        '/asr_status[^\\n]*(final)/i',
        '/"asr_status"\\s*:\\s*"final"/i',
        CLOUD_ASR_END_KEYWORD
      ].join('\n'),
      asrFailureKeywords: [
        '/ASR_STATUS.*UNIDENTIFIED/i',
        '/asr_status[^\\n]*(unidentified)/i',
        '/"asr_status"\\s*:\\s*"unidentified"/i'
      ].join('\n'),
      asrKeywords: [
        'ASR result',
        'asrText',
        'recognizedText',
        'finalResult'
      ].join('\n'),
      asrPatterns: [
        CLOUD_ASR_TEXT_PATTERN,
        "/(?:ASR result|asrText|recognizedText|finalResult)\\s*[:=]\\s*[\"']?([^\"',，。；;\\]\\}]+)/i"
      ].join('\n')
    },
    autonomousResponse: {
      enabled: false,
      microphoneDeviceId: '',
      responseWindowMs: 15000,
      responseMaxWaitMs: 120000,
      silenceMs: 1200,
      minDurationMs: 500,
      noiseThreshold: 0.02,
      language: 'zh-CN',
      preRollMs: 1500,
      postRollMs: 1000,
      replyStartTimeoutMs: 20000,
      charsPerSecond: 4.2,
      durationBufferRatio: 0.35,
      minProtectRatio: 0.75,
      minProtectMs: 10000,
      maxRecordMs: 120000,
      shortTextSilenceEndMs: 2000,
      longTextSilenceEndMs: 3500,
      veryLongTextSilenceEndMs: 5000,
      afterFinishCooldownMs: 3000,
      langfuseResponseGateEnabled: false,
      langfuseResponseTimeoutMs: 120000,
      langfuseResponsePollIntervalMs: 3000
    },
    agentEvaluation: {
      selectedMetrics: [...DEFAULT_AGENT_EVALUATION_METRICS]
    }
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

  // 自主监测过程日志
  processLogs: [],

  // 测试报告
  report: {
    runId: '',
    startTime: null,
    endTime: null,
    firstTestAudioTime: null,
    lastTestAudioTime: null,
    langfuseFetchEndTime: null,
    langfuseAutoFetchRequestedAt: null,
    langfuseEnvKey: DEFAULT_LANGFUSE_ENV_KEY,
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
  SET_DINGTALK_ENABLED: 'SET_DINGTALK_ENABLED',
  SET_AUTO_FETCH_LANGFUSE_LOGS: 'SET_AUTO_FETCH_LANGFUSE_LOGS',
  SET_SELECTED_LANGFUSE_ENV: 'SET_SELECTED_LANGFUSE_ENV',
  SET_SELECTED_TEST_MODULE: 'SET_SELECTED_TEST_MODULE',
  SET_DEVICE_OPTIONS: 'SET_DEVICE_OPTIONS',
  SET_AUTONOMOUS_WAKE: 'SET_AUTONOMOUS_WAKE',
  SET_AUTONOMOUS_INPUT: 'SET_AUTONOMOUS_INPUT',
  SET_AUTONOMOUS_RESPONSE: 'SET_AUTONOMOUS_RESPONSE',
  SET_AGENT_EVALUATION_METRICS: 'SET_AGENT_EVALUATION_METRICS',
  SET_PLAYBACK_STATE: 'SET_PLAYBACK_STATE',
  START_PLAYBACK: 'START_PLAYBACK',
  PAUSE_PLAYBACK: 'PAUSE_PLAYBACK',
  STOP_PLAYBACK: 'STOP_PLAYBACK',
  UPDATE_ELAPSED_TIME: 'UPDATE_ELAPSED_TIME',
  SET_REPORT: 'SET_REPORT',
  APPEND_PROCESS_LOG: 'APPEND_PROCESS_LOG',
  CLEAR_PROCESS_LOGS: 'CLEAR_PROCESS_LOGS',
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
        defaultVoiceConfig: normalizeVoiceConfigByLang({ ...state.defaultVoiceConfig, ...action.payload })
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

    case ActionTypes.SET_DINGTALK_ENABLED:
      return {
        ...state,
        testOptions: {
          ...state.testOptions,
          dingTalkEnabled: Boolean(action.payload)
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

    case ActionTypes.SET_DEVICE_OPTIONS:
      return {
        ...state,
        testOptions: {
          ...state.testOptions,
          device: {
            ...getDefaultDeviceOptions(),
            ...(state.testOptions.device || {}),
            ...action.payload
          }
        }
      };

    case ActionTypes.SET_AUTONOMOUS_WAKE:
      return {
        ...state,
        testOptions: {
          ...state.testOptions,
          autonomousWake: {
            ...state.testOptions.autonomousWake,
            ...action.payload
          }
        }
      };

    case ActionTypes.SET_AUTONOMOUS_INPUT:
      return {
        ...state,
        testOptions: {
          ...state.testOptions,
          autonomousInput: {
            ...state.testOptions.autonomousInput,
            ...action.payload
          }
        }
      };

    case ActionTypes.SET_AUTONOMOUS_RESPONSE:
      return {
        ...state,
        testOptions: {
          ...state.testOptions,
          autonomousResponse: {
            ...state.testOptions.autonomousResponse,
            ...action.payload
          }
        }
      };

    case ActionTypes.SET_AGENT_EVALUATION_METRICS:
      return {
        ...state,
        testOptions: {
          ...state.testOptions,
          agentEvaluation: {
            ...(state.testOptions.agentEvaluation || {}),
            selectedMetrics: normalizeSelectedEvaluationMetrics(action.payload)
          }
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
          langfuseEnvKey: state.testOptions.selectedLangfuseEnv || DEFAULT_LANGFUSE_ENV_KEY,
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

    case ActionTypes.APPEND_PROCESS_LOG: {
      const nextLog = action.payload || {};
      const nextSignature = createProcessLogSignature(nextLog);
      const logs = state.processLogs || [];
      const exists = logs.some((log) => createProcessLogSignature(log) === nextSignature);
      if (exists) return state;

      return {
        ...state,
        processLogs: [
          ...logs,
          nextLog
        ].slice(-1000)
      };
    }

    case ActionTypes.CLEAR_PROCESS_LOGS:
      return {
        ...state,
        processLogs: []
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
        report: initialState.report,
        processLogs: []
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
        const parsed = sanitizePersistedVoiceAutoState(JSON.parse(saved));
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
          defaultVoiceConfig: normalizeVoiceConfigByLang({
            ...init.defaultVoiceConfig,
            ...parsed.defaultVoiceConfig
          }),
          testAudios: parsed.testAudios || [],
          testOptions: {
            ...init.testOptions,
            loopCount: Math.max(1, Math.min(99, parsed.testOptions?.loopCount || init.testOptions.loopCount)),
            debugSequence: Boolean(parsed.testOptions?.debugSequence),
            dingTalkEnabled: Boolean(parsed.testOptions?.dingTalkEnabled),
            autoFetchLangfuseLogs: parsed.testOptions?.autoFetchLangfuseLogs !== false,
            selectedLangfuseEnv: parsed.testOptions?.selectedLangfuseEnv || DEFAULT_LANGFUSE_ENV_KEY,
            selectedTestModule: parsed.testOptions?.selectedTestModule || 'all',
            device: {
              ...getDefaultDeviceOptions(),
              ...(parsed.testOptions?.device || {}),
              type: parsed.testOptions?.device?.type === DEVICE_TYPES.AI_TOY
                ? DEVICE_TYPES.AI_TOY
                : DEVICE_TYPES.SPEAKER,
              logSource: parsed.testOptions?.device?.logSource === LOG_SOURCES.SERIAL
                ? LOG_SOURCES.SERIAL
                : LOG_SOURCES.ADB,
              serialPort: String(parsed.testOptions?.device?.serialPort || ''),
              baudrate: Number(parsed.testOptions?.device?.baudrate)
                || getDefaultDeviceOptions().baudrate,
              speakerContinuousDialogue: Boolean(parsed.testOptions?.device?.speakerContinuousDialogue)
            },
            autonomousWake: {
              ...init.testOptions.autonomousWake,
              ...(parsed.testOptions?.autonomousWake || {}),
              detectionTimeoutMs: Math.max(
                1000,
                Number(parsed.testOptions?.autonomousWake?.detectionTimeoutMs)
                || init.testOptions.autonomousWake.detectionTimeoutMs
              ),
              failureThreshold: 5,
              recoveryTimeoutMs: Math.max(
                10000,
                Number(parsed.testOptions?.autonomousWake?.recoveryTimeoutMs)
                || init.testOptions.autonomousWake.recoveryTimeoutMs
              ),
              maxRebootsPerCase: Math.max(
                0,
                Number.isFinite(Number(parsed.testOptions?.autonomousWake?.maxRebootsPerCase))
                  ? Number(parsed.testOptions.autonomousWake.maxRebootsPerCase)
                  : init.testOptions.autonomousWake.maxRebootsPerCase
              ),
              maxRebootsPerRun: Math.max(
                0,
                Number.isFinite(Number(parsed.testOptions?.autonomousWake?.maxRebootsPerRun))
                  ? Number(parsed.testOptions.autonomousWake.maxRebootsPerRun)
                  : init.testOptions.autonomousWake.maxRebootsPerRun
              ),
              keywords: parsed.testOptions?.autonomousWake?.keywords
                || init.testOptions.autonomousWake.keywords
            },
            autonomousInput: {
              ...init.testOptions.autonomousInput,
              ...(parsed.testOptions?.autonomousInput || {}),
              asrDetectionTimeoutMs: Math.max(
                1000,
                Number(parsed.testOptions?.autonomousInput?.asrDetectionTimeoutMs)
                || init.testOptions.autonomousInput.asrDetectionTimeoutMs
              ),
              asrSimilarityThreshold: Math.max(
                0,
                Math.min(
                  1,
                  Number(parsed.testOptions?.autonomousInput?.asrSimilarityThreshold)
                  || init.testOptions.autonomousInput.asrSimilarityThreshold
                )
              ),
              asrKeywords: parsed.testOptions?.autonomousInput?.asrKeywords
                || init.testOptions.autonomousInput.asrKeywords,
              asrStartKeywords: mergeConfigLines(
                parsed.testOptions?.autonomousInput?.asrStartKeywords
                  || init.testOptions.autonomousInput.asrStartKeywords,
                [CLOUD_ASR_START_KEYWORD]
              ),
              asrEndKeywords: mergeConfigLines(
                parsed.testOptions?.autonomousInput?.asrEndKeywords
                  || parsed.testOptions?.autonomousInput?.asrKeywords
                  || init.testOptions.autonomousInput.asrEndKeywords,
                [CLOUD_ASR_END_KEYWORD]
              ),
              asrFailureKeywords: parsed.testOptions?.autonomousInput?.asrFailureKeywords
                || init.testOptions.autonomousInput.asrFailureKeywords,
              asrPatterns: mergeConfigLines(
                parsed.testOptions?.autonomousInput?.asrPatterns
                  || init.testOptions.autonomousInput.asrPatterns,
                [CLOUD_ASR_TEXT_PATTERN]
              )
            },
            autonomousResponse: {
              ...init.testOptions.autonomousResponse,
              ...(parsed.testOptions?.autonomousResponse || {}),
              responseWindowMs: Math.max(
                1000,
                Number(parsed.testOptions?.autonomousResponse?.responseWindowMs)
                || init.testOptions.autonomousResponse.responseWindowMs
              ),
              responseMaxWaitMs: Math.max(
                60000,
                Number(parsed.testOptions?.autonomousResponse?.responseMaxWaitMs)
                || init.testOptions.autonomousResponse.responseMaxWaitMs
              ),
              silenceMs: Math.max(
                300,
                Number(parsed.testOptions?.autonomousResponse?.silenceMs)
                || init.testOptions.autonomousResponse.silenceMs
              ),
              minDurationMs: Math.max(
                100,
                Number(parsed.testOptions?.autonomousResponse?.minDurationMs)
                || init.testOptions.autonomousResponse.minDurationMs
              ),
              noiseThreshold: Math.max(
                0.001,
                Number(parsed.testOptions?.autonomousResponse?.noiseThreshold)
                || init.testOptions.autonomousResponse.noiseThreshold
              ),
              preRollMs: Math.max(
                0,
                Number(parsed.testOptions?.autonomousResponse?.preRollMs)
                || init.testOptions.autonomousResponse.preRollMs
              ),
              postRollMs: Math.max(
                0,
                Number(parsed.testOptions?.autonomousResponse?.postRollMs)
                || init.testOptions.autonomousResponse.postRollMs
              ),
              replyStartTimeoutMs: Math.max(
                5000,
                Number(parsed.testOptions?.autonomousResponse?.replyStartTimeoutMs)
                || init.testOptions.autonomousResponse.replyStartTimeoutMs
              ),
              charsPerSecond: Math.max(
                1,
                Number(parsed.testOptions?.autonomousResponse?.charsPerSecond)
                || init.testOptions.autonomousResponse.charsPerSecond
              ),
              durationBufferRatio: Math.max(
                0,
                Number(parsed.testOptions?.autonomousResponse?.durationBufferRatio)
                || init.testOptions.autonomousResponse.durationBufferRatio
              ),
              minProtectRatio: Math.max(
                0,
                Number(parsed.testOptions?.autonomousResponse?.minProtectRatio)
                || init.testOptions.autonomousResponse.minProtectRatio
              ),
              minProtectMs: Math.max(
                3000,
                Number(parsed.testOptions?.autonomousResponse?.minProtectMs)
                || init.testOptions.autonomousResponse.minProtectMs
              ),
              maxRecordMs: Math.max(
                60000,
                Number(parsed.testOptions?.autonomousResponse?.maxRecordMs)
                || init.testOptions.autonomousResponse.maxRecordMs
              ),
              shortTextSilenceEndMs: Math.max(
                800,
                Number(parsed.testOptions?.autonomousResponse?.shortTextSilenceEndMs)
                || init.testOptions.autonomousResponse.shortTextSilenceEndMs
              ),
              longTextSilenceEndMs: Math.max(
                2000,
                Number(parsed.testOptions?.autonomousResponse?.longTextSilenceEndMs)
                || init.testOptions.autonomousResponse.longTextSilenceEndMs
              ),
              veryLongTextSilenceEndMs: Math.max(
                3000,
                Number(parsed.testOptions?.autonomousResponse?.veryLongTextSilenceEndMs)
                || init.testOptions.autonomousResponse.veryLongTextSilenceEndMs
              ),
              afterFinishCooldownMs: Math.max(
                0,
                Number(parsed.testOptions?.autonomousResponse?.afterFinishCooldownMs)
                || init.testOptions.autonomousResponse.afterFinishCooldownMs
              ),
              langfuseResponseGateEnabled: parsed.testOptions?.autonomousResponse?.langfuseResponseGateEnabled === true,
              langfuseResponseTimeoutMs: Math.max(
                60000,
                Number(parsed.testOptions?.autonomousResponse?.langfuseResponseTimeoutMs)
                || init.testOptions.autonomousResponse.langfuseResponseTimeoutMs
              ),
              langfuseResponsePollIntervalMs: Math.max(
                1000,
                Number(parsed.testOptions?.autonomousResponse?.langfuseResponsePollIntervalMs)
                || init.testOptions.autonomousResponse.langfuseResponsePollIntervalMs
              )
            },
            agentEvaluation: {
              ...init.testOptions.agentEvaluation,
              ...(parsed.testOptions?.agentEvaluation || {}),
              selectedMetrics: normalizeSelectedEvaluationMetrics(
                parsed.testOptions?.agentEvaluation?.selectedMetrics
              )
            }
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
    const handleProcessLog = (event) => {
      dispatch({
        type: ActionTypes.APPEND_PROCESS_LOG,
        payload: event.detail
      });
    };

    window.addEventListener('voiceauto-process-log', handleProcessLog);
    return () => window.removeEventListener('voiceauto-process-log', handleProcessLog);
  }, []);

  useEffect(() => {
    const serializedAudios = state.testAudios.map((audio) => {
      const {
        audioBlob,
        originalFile,
        audioUrl,
        ...rest
      } = audio;
      const isTemporaryGeneratedAudio = typeof audioUrl === 'string' && audioUrl.startsWith('blob:');

      return {
        ...rest,
        audioStatus: isTemporaryGeneratedAudio ? 'not_generated' : rest.audioStatus,
        // Blob/File 不能可靠持久化；文件音频 URL 刷新后也可能失效
        audioBlob: null,
        audioUrl: audio.source === 'file' || isTemporaryGeneratedAudio ? null : (audioUrl || null),
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

  setDingTalkEnabled: (enabled) => ({
    type: ActionTypes.SET_DINGTALK_ENABLED,
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

  setDeviceOptions: (configPatch) => ({
    type: ActionTypes.SET_DEVICE_OPTIONS,
    payload: configPatch
  }),

  setAutonomousWake: (configPatch) => ({
    type: ActionTypes.SET_AUTONOMOUS_WAKE,
    payload: configPatch
  }),

  setAutonomousInput: (configPatch) => ({
    type: ActionTypes.SET_AUTONOMOUS_INPUT,
    payload: configPatch
  }),

  setAutonomousResponse: (configPatch) => ({
    type: ActionTypes.SET_AUTONOMOUS_RESPONSE,
    payload: configPatch
  }),

  setAgentEvaluationMetrics: (metrics) => ({
    type: ActionTypes.SET_AGENT_EVALUATION_METRICS,
    payload: metrics
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

  appendProcessLog: (log) => ({
    type: ActionTypes.APPEND_PROCESS_LOG,
    payload: log
  }),

  clearProcessLogs: () => ({
    type: ActionTypes.CLEAR_PROCESS_LOGS
  }),

  completeReport: () => ({
    type: ActionTypes.COMPLETE_REPORT
  }),

  resetTest: () => ({
    type: ActionTypes.RESET_TEST
  })
};
