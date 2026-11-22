// hyperdb-edge in Codex, with a fake model and no model calls (docs/wip/hyperdb_edge.md). The model calls
// hyperdb-edge through exec_command, the tests check the outputs of the commands and the files they left in the
// workspace.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { functionCall, functionCallOutputs, message, startFakeOpenAI } from './fake_openai.mjs';
import { installEdgeSkill, SKILL_DESCRIPTION, writeEdgeCommand } from './hyperdb_edge.mjs';
import { requireLinuxSandboxTools, runHarness } from './probes.mjs';

const CODEX = resolve(process.env.CODEX_BINARY);
const ROOT = mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'hyperdb-edge-codex-'));
const EDGE = writeEdgeCommand(join(ROOT, 'bin'));

// Codex brings its own bubblewrap, it still needs unprivileged user namespaces
requireLinuxSandboxTools([]);

/// Run `codex exec` with a fake model that calls exec_command with each command in turn
async function runCodex(dir, { commands, sandbox = 'workspace-write', skill = false }) {
    const codexHome = join(dir, 'codex');
    const work = join(dir, 'work');
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(work, { recursive: true });
    if (skill) installEdgeSkill(join(codexHome, 'skills'));
    const model = await startFakeOpenAI({
        turn: request => {
            const done = functionCallOutputs(request).length;
            return done < commands.length ? [functionCall('exec_command', { cmd: commands[done] })] : [message('done')];
        },
    });
    writeFileSync(join(codexHome, 'config.toml'), `model = "fake-model"
model_provider = "fake"

[model_providers.fake]
name = "fake"
base_url = "${model.url}/v1"
wire_api = "responses"
env_key = "FAKE_API_KEY"
`);
    try {
        const output = await runHarness(CODEX, ['exec', '--skip-git-repo-check', '--json', '--sandbox', sandbox, 'use hyperdb-edge'], {
            cwd: work,
            env: { PATH: '/usr/bin:/bin', HOME: join(dir, 'home'), CODEX_HOME: codexHome, FAKE_API_KEY: 'fake' },
        });
        const results = output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
            .filter(event => event.type === 'item.completed' && event.item?.type === 'command_execution')
            .map(event => ({ output: event.item.aggregated_output.trim(), exitCode: event.item.exit_code }));
        assert.equal(results.length, commands.length, `one result per command, got ${JSON.stringify(results)}`);
        return { results, work, requests: model.requests };
    } finally {
        await model.close();
    }
}

function caseDir(name) {
    const dir = join(ROOT, name);
    mkdirSync(dir, { recursive: true });
    return dir;
}

test('describe runs in workspace-write', async () => {
    const { results } = await runCodex(caseDir('describe'), { commands: [`${EDGE} describe`] });
    assert.equal(results[0].exitCode, 0, results[0].output);
    assert.match(results[0].output, /^# hyperdb-edge/);
});

test('run keeps a database in the workspace across calls, without network', async () => {
    const { results, work } = await runCodex(caseDir('database'), {
        commands: [
            `${EDGE} run --db sales.hyper -c "create table sales(region text, amount int); insert into sales values ('north', 10), ('south', 20)"`,
            `${EDGE} run --db sales.hyper --format json -c "select region, amount from sales order by region"`,
        ],
    });
    assert.equal(results[0].exitCode, 0, results[0].output);
    assert.match(results[0].output, /INSERT 2/);
    assert.equal(results[1].exitCode, 0, results[1].output);
    assert.deepEqual(JSON.parse(results[1].output).rows, [['north', 10], ['south', 20]]);
    assert.ok(existsSync(join(work, 'sales.hyper')));
    assert.ok(!existsSync(join(work, 'sales.hyper.lock')));
});

test('run writes and reads files of the workspace', async () => {
    const { results, work } = await runCodex(caseDir('files'), {
        commands: [
            `${EDGE} run -c "copy (select g from generate_series(1, 5) as s(g)) to '/mnt/external/work/five.parquet' with (format => 'parquet')"`,
            `${EDGE} run --format json -c "select count(*) as n from external('/mnt/external/work/five.parquet')"`,
        ],
    });
    assert.equal(results[0].output, 'COPY 5', results[0].output);
    assert.deepEqual(JSON.parse(results[1].output).rows, [[5]]);
    assert.ok(existsSync(join(work, 'five.parquet')));
});

test('a failing statement fails with 1 and the message of Hyper', async () => {
    const { results } = await runCodex(caseDir('failure'), { commands: [`${EDGE} run -c "select * from missing_table"`] });
    assert.equal(results[0].exitCode, 1, results[0].output);
    assert.match(results[0].output, /SQLSTATE 42P01/);
});

test('read-only allows describe', async () => {
    const { results } = await runCodex(caseDir('read_only'), { commands: [`${EDGE} describe`], sandbox: 'read-only' });
    assert.equal(results[0].exitCode, 0, results[0].output);
});

test('the skill reaches the model', async () => {
    const { requests } = await runCodex(caseDir('skill'), { commands: [], skill: true });
    assert.ok(requests.some(request => JSON.stringify(request).includes(SKILL_DESCRIPTION)), 'the description of the skill in a request');
});
