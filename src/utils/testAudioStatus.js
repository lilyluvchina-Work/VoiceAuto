import { sortTestCasesByDirectoryOrder } from './testCaseOrdering.js';

export function isGeneratedTestAudio(audio) {
  return audio?.audioStatus === 'generated';
}

export function selectGeneratedTestAudios(audios, directory = 'all') {
  return sortTestCasesByDirectoryOrder((audios || []).filter(isGeneratedTestAudio), { directory });
}
