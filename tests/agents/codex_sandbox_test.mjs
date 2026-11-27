// Where the sandbox of Codex ends, with a fake model and no model calls (docs/design/agent_integration_tests.md).
// The model calls exec_command once, e.g. with a probe that connects to a server on loopback, and a prefix rule of the
// execution policy lets a command out of the sandbox.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { functionCall, functionCallOutputs, message, startFakeOpenAI } from './fake_openai.mjs';
import { startDashQLApp, stepsOf } from './dashql_app.mjs';
import { requireLinuxSandboxTools, runHarness, startLoopbackTarget, writeProbe } from './probes.mjs';

const CODEX = resolve(process.env.CODEX_BINARY);
const ROOT = mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'codex-'));

let target;

before(async () => {
    // Codex brings its own bubblewrap, it still needs unprivileged user namespaces
    requireLinuxSandboxTools([]);
    target = await startLoopbackTarget();
});

after(() => target?.close());

/// The config of Codex with the fake model
function writeCodexConfig(codexHome, model) {
    writeFileSync(join(codexHome, 'config.toml'), `model = "fake-model"
model_provider = "fake"

[model_providers.fake]
name = "fake"
base_url = "${model.url}/v1"
wire_api = "responses"
env_key = "FAKE_API_KEY"
`);
}

/// Run `codex exec` with a fake model that calls exec_command once
async function runCodex(dir, { command, sandbox = 'workspace-write', allowPrefix = null, escalate = false, env = {} }) {
    const codexHome = join(dir, 'codex');
    const work = join(dir, 'work');
    mkdirSync(join(codexHome, 'rules'), { recursive: true });
    mkdirSync(work, { recursive: true });
    const model = await startFakeOpenAI({
        turn: request => functionCallOutputs(request).length === 0
            ? [functionCall('exec_command', {
                cmd: command,
                ...(escalate ? { sandbox_permissions: 'require_escalated', justification: 'runs the query against the remote engine' } : {}),
            })]
            : [message('done')],
    });
    writeCodexConfig(codexHome, model);
    if (allowPrefix != null) {
        writeFileSync(join(codexHome, 'rules', 'default.rules'), `prefix_rule(
    pattern = [${JSON.stringify(allowPrefix)}],
    decision = "allow",
)
`);
    }
    try {
        const args = ['exec', '--skip-git-repo-check', '--json', '--sandbox', sandbox, 'run the probe'];
        const output = await runHarness(CODEX, args, {
            cwd: work,
            env: { PATH: '/usr/bin:/bin', HOME: join(dir, 'home'), CODEX_HOME: codexHome, FAKE_API_KEY: 'fake', ...env },
        });
        const commands = output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
            .filter(event => event.type === 'item.completed' && event.item?.type === 'command_execution')
            .map(event => event.item.aggregated_output.trim());
        const outputs = model.requests.flatMap(functionCallOutputs).map(item => String(item.output));
        return { commands, outputs };
    } finally {
        await model.close();
    }
}

/// A fresh folder for a test case
function caseDir(name) {
    const dir = join(ROOT, name);
    mkdirSync(dir, { recursive: true });
    return dir;
}

test('a command in workspace-write cannot reach loopback', async () => {
    const dir = caseDir('workspace_write');
    const probe = writeProbe(dir, target.port);
    const { commands } = await runCodex(dir, { command: probe });
    assert.deepEqual(commands, ['loopback:blocked']);
});

test('a command that an allow rule matches runs outside the sandbox', async () => {
    const dir = caseDir('allow_rule');
    const probe = writeProbe(dir, target.port);
    const { commands } = await runCodex(dir, { command: probe, allowPrefix: probe });
    assert.deepEqual(commands, ['loopback:ok']);
});

test('codex exec rejects a request to escalate, with or without a rule', async () => {
    for (const rule of [false, true]) {
        const dir = caseDir(`escalate_${rule}`);
        const probe = writeProbe(dir, target.port);
        const { commands, outputs } = await runCodex(dir, { command: probe, escalate: true, allowPrefix: rule ? probe : null });
        assert.deepEqual(commands, []);
        assert.ok(outputs.some(output => output.includes('approval policy is Never')), JSON.stringify(outputs));
    }
});

test('the app runs Codex for a question: the agent calls the workbook with dashql, the next question resumes', async () => {
    const dir = caseDir('app');
    const codexHome = join(dir, 'codex');
    mkdirSync(codexHome, { recursive: true });
    const root = join(dir, 'agent');
    // The agent lists the scripts and passes a script to edit on stdin, then answers. The second question gets an
    // answer at once.
    const calls = [
        functionCall('exec_command', { cmd: 'dashql scripts' }),
        functionCall('exec_command', { cmd: "dashql edit orders <<'EOF'\nselect count(*) from orders\nEOF" }),
    ];
    const model = await startFakeOpenAI({
        turn: (_request, index) => index < calls.length ? [calls[index]] : [message(index === calls.length ? 'There are 42 orders.' : 'Per day too.')],
    });
    writeCodexConfig(codexHome, model);
    const app = startDashQLApp({
        root,
        env: { PATH: '/usr/bin:/bin', HOME: join(dir, 'home'), CODEX_HOME: codexHome, FAKE_API_KEY: 'fake' },
        searchPath: [dirname(CODEX), '/usr/bin', '/bin'].join(':'),
        answer: call => call.command === 'scripts' ? 'orders.sql\n' : `${call.args.script}.sql changed\n`,
    });
    try {
        const first = await app.ask('w1', 'codex', 'How many orders?');
        assert.deepEqual(first.at(-1), { event: 'Stop', message: 'There are 42 orders.', error: null });
        // The page tells the dashql commands from their calls, the host leaves out the steps that ran them
        assert.deepEqual(stepsOf(first), []);
        // The sandbox of workspace-write with network access lets dashql reach the app
        assert.deepEqual(app.page.calls.map(({ workbookId, command, args, input }) => ({ workbookId, command, args, input })), [
            { workbookId: 'w1', command: 'scripts', args: {}, input: null },
            { workbookId: 'w1', command: 'edit', args: { script: 'orders' }, input: 'select count(*) from orders\n' },
        ]);
        const outputs = model.requests.flatMap(functionCallOutputs).map(item => String(item.output));
        assert.ok(outputs.some(output => output.includes('orders.sql changed')), JSON.stringify(outputs));
        // Codex reads the guide from the AGENTS.md of the folder of the workbook
        assert.ok(model.requests.some(request => JSON.stringify(request.input ?? '').includes('dashql scripts')), 'the guide is in no request');
        const state = JSON.parse(readFileSync(join(root, 'workbooks', 'w1', 'state.json'), 'utf8'));
        assert.equal(typeof state.sessions.codex, 'string');

        // The next question continues the thread
        const second = await app.ask('w1', 'codex', 'And per day?');
        assert.deepEqual(second.at(-1), { event: 'Stop', message: 'Per day too.', error: null });
        assert.ok(JSON.stringify(model.requests.at(-1).input).includes('How many orders?'), 'the second question does not resume the first');
    } finally {
        await app.close();
        await model.close();
    }
});
