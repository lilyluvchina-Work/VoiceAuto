const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const OUTPUT_FILE = path.join(LOG_DIR, 'error-summary.log');
const ERROR_PATTERN = /(STARTUP_ERROR|ERROR|Error|error|failed|fail|异常|失败|错误)/;

function listLogFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter((file) => file !== OUTPUT_FILE)
    .filter((file) => /\.(log|out|err)$/i.test(file));
}

async function collectFileErrors(file, output) {
  const relativeFile = path.relative(ROOT, file);
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  let matchCount = 0;

  for await (const line of reader) {
    lineNumber += 1;
    if (!ERROR_PATTERN.test(line)) continue;
    if (matchCount === 0) {
      output.push('');
      output.push(`===== ${relativeFile} =====`);
    }
    matchCount += 1;
    output.push(`${lineNumber}: ${line}`);
  }

  return matchCount;
}

async function main() {
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const files = listLogFiles(LOG_DIR);
  const output = [
    `Error log summary generated at ${new Date().toISOString()}`,
    `Source directory: ${LOG_DIR}`,
    `Matched pattern: ${ERROR_PATTERN}`,
  ];

  let totalMatches = 0;
  for (const file of files) {
    totalMatches += await collectFileErrors(file, output);
  }

  output.push('');
  output.push(`Total matched lines: ${totalMatches}`);
  fs.writeFileSync(OUTPUT_FILE, `${output.join('\n')}\n`, 'utf8');

  console.log(`Collected ${totalMatches} error lines into ${path.relative(ROOT, OUTPUT_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
