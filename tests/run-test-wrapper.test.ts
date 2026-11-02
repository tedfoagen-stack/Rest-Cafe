const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

// run-test.cjs exit-77 rule (F-019): the GNU skip code 77 is honoured only
// for suites on the wrapper's DECLARED_ENVIRONMENT_SKIPS list. Anything
// else exiting 77 must fail loudly. This suite pins the rule and keeps the
// list in sync with the ABI-guard sites in tests/*.test.ts.
const {
  DECLARED_ENVIRONMENT_SKIPS,
  suiteNameFromArgs,
  resolveExitCode,
} = require('../scripts/run-test.cjs');
const {
  assertOrThrow,
  assertEqualOrThrow,
  assertIncludesOrThrow,
  getResults,
} = require('./helpers/test-setup');

const rootDir = path.resolve(__dirname, '..');

function main() {
  // 1. Declared suites exit 0 on 77.
  assertEqualOrThrow(
    resolveExitCode(77, 'test:cash-closures'),
    0,
    'declared suite exiting 77 resolves to 0',
  );
  assertEqualOrThrow(
    resolveExitCode(77, 'test:printer'),
    0,
    'declared composite (chains an ABI-guarded suite) exiting 77 resolves to 0',
  );
  assertEqualOrThrow(
    resolveExitCode(77, 'test:upgrade-regression'),
    0,
    'declared alias exiting 77 resolves to 0',
  );

  // 2. Undeclared suites fail on 77; an unidentifiable command fails too.
  assertEqualOrThrow(
    resolveExitCode(77, 'test:smoke'),
    1,
    'undeclared suite exiting 77 resolves to 1',
  );
  assertEqualOrThrow(
    resolveExitCode(77, null),
    1,
    'unidentifiable command exiting 77 resolves to 1',
  );

  // 3. Any other status passes through untouched.
  assertEqualOrThrow(resolveExitCode(0, 'test:cash-closures'), 0, 'exit 0 passes through');
  assertEqualOrThrow(resolveExitCode(1, 'test:cash-closures'), 1, 'exit 1 passes through');
  assertEqualOrThrow(resolveExitCode(3, 'test:smoke'), 3, 'exit 3 passes through');

  // 4. Suite-name parsing.
  assertEqualOrThrow(
    suiteNameFromArgs(['npm', 'run', 'test:cash-closures']),
    'test:cash-closures',
    'parses npm run <suite>',
  );
  assertEqualOrThrow(
    suiteNameFromArgs(['node', '-e', 'process.exit(77)']),
    null,
    'non-npm-run command has no suite',
  );

  // 5. The list stays in sync with package.json and the guard sites.
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  for (const name of Object.keys(DECLARED_ENVIRONMENT_SKIPS)) {
    assertOrThrow(
      typeof pkg.scripts[name] === 'string',
      `declared skip ${name} must still be a script in package.json`,
    );
    assertOrThrow(
      DECLARED_ENVIRONMENT_SKIPS[name].trim().length >= 12,
      `declared skip ${name} must carry a useful reason`,
    );
  }
  // This file itself mentions process.exit(77) in its assertions, so it is
  // excluded from the scan: it is the validator, not a guarded suite.
  const guardFiles = fs
    .readdirSync(path.join(rootDir, 'tests'))
    .filter((name: string) => /\.test\.ts$/.test(name) && name !== 'run-test-wrapper.test.ts')
    .filter((name: string) =>
      fs.readFileSync(path.join(rootDir, 'tests', name), 'utf8').includes('process.exit(77)'),
    );
  assertOrThrow(guardFiles.length > 0, 'at least one ABI-guard site must exist to guard');
  for (const file of guardFiles) {
    const owners = Object.keys(pkg.scripts).filter((name: string) =>
      String(pkg.scripts[name]).includes(`tests/${file}`),
    );
    assertOrThrow(
      owners.some((name: string) => DECLARED_ENVIRONMENT_SKIPS[name]),
      `ABI-guard file ${file} must be run by a declared skip (owners: ${owners.join(', ') || 'none'})`,
    );
  }

  // 6. End to end through the wrapper: an unlisted command exiting 77
  // fails with exit 1 and names the rule; a clean exit passes through.
  const denied = spawnSync(
    process.execPath,
    [path.join(rootDir, 'scripts/run-test.cjs'), 'node', '-e', 'process.exit(77)'],
    { encoding: 'utf8', cwd: rootDir },
  );
  assertEqualOrThrow(
    denied.status,
    1,
    'wrapper exits 1 for unlisted 77 (got ' + denied.status + ')',
  );
  assertIncludesOrThrow(
    (denied.stderr || '') + (denied.stdout || ''),
    'not a declared environment skip',
    'wrapper failure names the declared-skip rule',
  );
  const clean = spawnSync(
    process.execPath,
    [path.join(rootDir, 'scripts/run-test.cjs'), 'node', '-e', 'process.exit(0)'],
    { encoding: 'utf8', cwd: rootDir },
  );
  assertEqualOrThrow(clean.status, 0, 'wrapper exits 0 for a clean command');

  const results = getResults();
  console.log(`\nrun-test wrapper: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) process.exit(1);
}

main();
