import { resolveTestCaseDirectory, splitDirectoryPath } from './testCaseOrdering.js';

export function getDirectoryFilterState(items, selection = []) {
  const paths = (items || []).map(item => splitDirectoryPath(resolveTestCaseDirectory(item)));
  const selectedPath = [];
  const levels = [];
  for (let level = 0; level < 3; level++) {
    const counts = new Map();
    if (selectedPath.length === level) {
      for (const path of paths) {
        if (!path[level] || !selectedPath.every((part, index) => path[index] === part)) continue;
        counts.set(path[level], (counts.get(path[level]) || 0) + 1);
      }
    }
    levels.push(Array.from(counts, ([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')));
    if (counts.has(selection[level])) selectedPath.push(selection[level]);
  }
  return { levels, selectedPath, directory: selectedPath.join(' / ') || 'all' };
}
