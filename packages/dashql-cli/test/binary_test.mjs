// dashql as the user calls it: the bundle of //packages/dashql-cli:dashql, its exit codes, stdin and the invoking
// directory
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
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

/// A port on 127.0.0.1 that nothing listens on
async function closedPort() {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

test('runs a workbook with the runtime and names the connection it can not reach', async () => {
    const dir = mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-'));
    const endpoint = `http://127.0.0.1:${await closedPort()}`;
    const connectionId = '0d9e8f7a-6b5c-4d3e-8f21-0a1b2c3d4e5f';
    writeFileSync(join(dir, 'dashql-workbook.json'), JSON.stringify({
        formatVersion: 11,
        workbookId: '6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f',
        connections: [{ connectionId, params: { trino: { endpoint, auth: { authType: 'AUTH_BASIC', basic: { username: 'ann', secret: '' } } } } }],
        scripts: [{ name: 'a.sql', connectionId }],
        attachments: [],
        metadata: {},
    }));
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(join(dir, 'scripts', 'a.sql'), 'select 1\n');
    const output = dashql(dir, ['run', '.']);
    assert.equal(output.status, 1, output.stderr);
    assert.ok(output.stdout.startsWith(`trino ${endpoint}  failed\n  fetch failed: connect ECONNREFUSED`), output.stdout);
});
