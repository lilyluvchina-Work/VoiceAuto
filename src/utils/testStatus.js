export function getWakeStatus(testCase) {
  if (testCase?.speakerWakeStatus === 'success') return 'success';
  if (testCase?.speakerWakeStatus || testCase?.wakeFailReason || testCase?.wakeFailStage) return 'failed';
  return 'unknown';
}

export function getAsrStatus(testCase) {
  if (testCase?.inputChainPassed === true) return 'success';
  if (testCase?.inputChainPassed === false || testCase?.asrStatus || testCase?.asrMatchResult === 'error') return 'failed';
  return 'unknown';
}

export function getTtsStatus(testCase) {
  if (testCase?.expectsVoiceResponse === false || testCase?.responseChainPassed === 'skipped_no_voice_expected') return 'skipped';
  if (testCase?.responseChainPassed === true) return 'success';
  if (testCase?.responseChainPassed === false || testCase?.responseFailReason) return 'failed';
  return 'unknown';
}

export function countByStatus(testCases, resolver) {
  return (Array.isArray(testCases) ? testCases : []).reduce((acc, testCase) => {
    const status = resolver(testCase);
    if (status === 'success') acc.success += 1;
    if (status === 'failed') acc.failed += 1;
    return acc;
  }, { success: 0, failed: 0 });
}
