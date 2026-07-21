const ID_LIKE_RE = /^[\d\s,|\-_/]+$/;
const FALLBACK_DIRECTORY_RE = /^目录-\d+$/;

function cleanText(value) {
  return String(value ?? '').trim();
}

function isReadableDirectory(value) {
  const text = cleanText(value);
  return Boolean(text && !ID_LIKE_RE.test(text) && !FALLBACK_DIRECTORY_RE.test(text));
}

export function resolveTestCaseDirectory(item) {
  const candidates = [
    item?.tapdPlanDirectory,
    item?.tapdCategoryName,
    item?.caseDirectory,
    item?.tapdCategoryPath,
    item?.module,
  ];

  for (const candidate of candidates) {
    if (isReadableDirectory(candidate)) {
      return cleanText(candidate);
    }
  }

  return '未分类目录';
}

export function normalizeSortValue(value) {
  if (value === null || value === undefined) return null;
  const text = cleanText(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function resolveTestCaseSortValue(item) {
  const candidates = [
    item?.caseSort,
    item?.tapdCaseSort,
    item?.sort,
    item?.order,
    item?.position,
    item?.sequence,
    item?.displayOrder,
  ];

  for (const candidate of candidates) {
    const sortValue = normalizeSortValue(candidate);
    if (sortValue !== null) return sortValue;
  }

  return null;
}

function resolveImportIndex(item, fallbackIndex) {
  const candidates = [
    item?.importIndex,
    item?.tapdImportIndex,
    item?.createdIndex,
  ];

  for (const candidate of candidates) {
    const index = normalizeSortValue(candidate);
    if (index !== null) return index;
  }

  return fallbackIndex;
}

export function sortTestCasesByDirectoryOrder(items, options = {}) {
  const directoryFilter = options.directory || 'all';
  return [...(items || [])]
    .map((item, index) => ({
      item,
      index,
      directory: resolveTestCaseDirectory(item),
      sortValue: resolveTestCaseSortValue(item),
      importIndex: resolveImportIndex(item, index),
    }))
    .filter((entry) => directoryFilter === 'all' || entry.directory === directoryFilter)
    .sort((left, right) => {
      const directoryCompare = left.directory.localeCompare(right.directory, 'zh-CN');
      if (directoryCompare !== 0) return directoryCompare;

      const leftHasSort = left.sortValue !== null;
      const rightHasSort = right.sortValue !== null;
      if (leftHasSort && rightHasSort && left.sortValue !== right.sortValue) {
        return left.sortValue - right.sortValue;
      }
      if (leftHasSort !== rightHasSort) {
        return leftHasSort ? -1 : 1;
      }
      if (left.importIndex !== right.importIndex) {
        return left.importIndex - right.importIndex;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}
