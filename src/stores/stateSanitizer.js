import {
  DEFAULT_AGENT_EVALUATION_METRICS,
  normalizeSelectedEvaluationMetrics,
} from '../utils/agentEvaluation.js';

export function sanitizePersistedVoiceAutoState(parsed = {}) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const sourceTestOptions = source.testOptions && typeof source.testOptions === 'object'
    ? source.testOptions
    : {};
  const sourceAgentEvaluation = sourceTestOptions.agentEvaluation
    && typeof sourceTestOptions.agentEvaluation === 'object'
    ? sourceTestOptions.agentEvaluation
    : {};

  return {
    ...source,
    defaultVoiceConfig: source.defaultVoiceConfig && typeof source.defaultVoiceConfig === 'object'
      ? source.defaultVoiceConfig
      : {},
    testOptions: {
      ...sourceTestOptions,
      agentEvaluation: {
        ...sourceAgentEvaluation,
        selectedMetrics: normalizeSelectedEvaluationMetrics(
          sourceAgentEvaluation.selectedMetrics || DEFAULT_AGENT_EVALUATION_METRICS
        ),
      },
    },
    testAudios: Array.isArray(source.testAudios) ? source.testAudios : [],
  };
}
