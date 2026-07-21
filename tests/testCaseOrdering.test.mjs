import assert from 'node:assert/strict';
import {
  normalizeSortValue,
  sortTestCasesByDirectoryOrder,
} from '../src/utils/testCaseOrdering.js';

assert.equal(normalizeSortValue('003'), 3);
assert.equal(normalizeSortValue(' 12.5 '), 12.5);
assert.equal(normalizeSortValue(''), null);
assert.equal(normalizeSortValue('abc'), null);

const cases = [
  { id: 'a-3', module: 'A', caseSort: '3', importIndex: 0 },
  { id: 'b-1', module: 'B', caseSort: '1', importIndex: 1 },
  { id: 'a-1', module: 'A', caseSort: '1', importIndex: 2 },
  { id: 'a-none-first', module: 'A', importIndex: 3 },
  { id: 'a-none-second', module: 'A', importIndex: 4 },
  { id: 'b-0', module: 'B', caseSort: '0', importIndex: 5 },
];

assert.deepEqual(
  sortTestCasesByDirectoryOrder(cases).map((item) => item.id),
  ['a-1', 'a-3', 'a-none-first', 'a-none-second', 'b-0', 'b-1']
);

assert.deepEqual(
  sortTestCasesByDirectoryOrder(cases, { directory: 'B' }).map((item) => item.id),
  ['b-0', 'b-1']
);
