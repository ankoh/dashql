// dashql as the user calls it: the bundle of //packages/dashql-cli:dashql, its exit codes, stdin and the invoking
// directory
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const DASHQL = resolve(process.env.DASHQL_BINARY);

/// A directory with a script
function directory(script) {
    const dir = mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-'));
    writeFileSync(join(dir, 'a.sql'), script);
    return dir;
}

/// Run dashql in a directory, as `bazel run` does with BUILD_WORKING_DIRECTORY
function dashql(dir, args, input = '') {
    return spawnSync(DASHQL, args, { input, encoding: 'utf8', env: { ...process.env, BUILD_WORKING_DIRECTORY: dir, NO_COLOR: '1' } });
}

test('exits with 0 for a clean script', () => {
    const output = dashql(directory('select 1;\n'), ['lint', 'a.sql']);
    assert.equal(output.status, 0, output.stderr);
    assert.equal(output.stdout, '1 file, 0 errors, 0 warnings\n');
});

test('exits with 1 for a script with errors', () => {
    const output = dashql(directory('select 1 +;\n'), ['lint', 'a.sql']);
    assert.equal(output.status, 1, output.stderr);
    assert.ok(output.stdout.startsWith('a.sql\n'), output.stdout);
});

test('exits with 2 for a missing script and an unknown command', () => {
    const missing = dashql(directory(''), ['lint', 'gone.sql']);
    assert.equal(missing.status, 2);
    assert.ok(missing.stderr.includes('gone.sql'), missing.stderr);
    assert.equal(dashql(directory(''), ['bogus']).status, 2);
});

test('reads stdin and formats', () => {
    const output = dashql(directory(''), ['format', '-'], 'SELECT  1');
    assert.equal(output.status, 0, output.stderr);
    assert.equal(output.stdout, 'select 1;\n');
});
