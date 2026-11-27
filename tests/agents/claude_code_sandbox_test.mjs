// Where the sandbox of Claude Code ends, with a fake model and no model calls (docs/design/agent_integration_tests.md).
// The model calls Bash once, e.g. with a probe that connects to a server on loopback.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { startFakeAnthropic, text, toolResults, toolUse } from './fake_anthropic.mjs';
import { startDashQLApp, stepsOf } from './dashql_app.mjs';
import { requireLinuxSandboxTools, runHarness, startLoopbackTarget, writeProbe } from './probes.mjs';

const CLAUDE = resolve(process.env.CLAUDE_BINARY);
const ROOT = mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'claude-code-'));

let target;

before(async () => {
    requireLinuxSandboxTools(['bwrap', 'socat']);
    target = await startLoopbackTarget();
});

after(() => target?.close());

/// Run Claude Code headless with a fake model that calls Bash once, return the tool result
async function runClaude(dir, { command, toolInput = {}, sandbox = {}, allowedTools = 'Bash', env = {} }) {
    const home = join(dir, 'home');
    const work = join(dir, 'work');
    mkdirSync(home, { recursive: true });
    mkdirSync(work, { recursive: true });
    const model = await startFakeAnthropic({
        turn: request => toolResults(request).length === 0
            ? [toolUse('Bash', { command, description: 'probe', ...toolInput })]
            : [text('done')],
    });
    const settings = { sandbox: { enabled: true, ...sandbox } };
    try {
        const output = await runHarness(CLAUDE, [
            '-p', 'run the probe',
            '--output-format', 'stream-json', '--verbose',
            '--settings', JSON.stringify(settings),
            '--allowedTools', allowedTools,
        ], {
            cwd: work,
            env: {
                PATH: '/usr/bin:/bin',
                HOME: home,
                ANTHROPIC_BASE_URL: model.url,
                ANTHROPIC_API_KEY: 'sk-fake',
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
                DISABLE_AUTOUPDATER: '1',
                ...env,
            },
        });
        const results = output.split('\n').filter(Boolean).map(line => JSON.parse(line))
            .flatMap(event => event.type === 'user' && Array.isArray(event.message?.content) ? event.message.content : [])
            .filter(block => block.type === 'tool_result');
        assert.equal(results.length, 1, `one tool result, got ${JSON.stringify(results)}`);
        return { output: String(results[0].content).trim(), isError: results[0].is_error === true };
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

test('a command in the sandbox cannot reach loopback', async () => {
    const dir = caseDir('sandbox');
    const probe = writeProbe(dir, target.port);
    const { output } = await runClaude(dir, { command: probe });
    assert.equal(output, 'loopback:blocked');
});

test('a command without the sandbox reaches loopback', async () => {
    const dir = caseDir('no_sandbox');
    const probe = writeProbe(dir, target.port);
    const { output } = await runClaude(dir, { command: probe, sandbox: { enabled: false } });
    assert.equal(output, 'loopback:ok');
});

test('a command of sandbox.excludedCommands runs outside the sandbox', async () => {
    const dir = caseDir('excluded');
    const probe = writeProbe(dir, target.port);
    const { output } = await runClaude(dir, { command: probe, sandbox: { excludedCommands: [probe] } });
    assert.equal(output, 'loopback:ok');
});

test('a request to run outside the sandbox needs a rule for the command', async () => {
    const dir = caseDir('unsandboxed');
    const probe = writeProbe(dir, target.port);
    const toolInput = { dangerouslyDisableSandbox: true };
    // Allowing Bash in general doesn't allow it
    const refused = await runClaude(join(dir, 'any'), { command: probe, toolInput });
    assert.ok(refused.isError, JSON.stringify(refused));
    assert.match(refused.output, /outside of the sandbox/);
    // A rule for the command does
    const allowed = await runClaude(join(dir, 'rule'), { command: probe, toolInput, allowedTools: `Bash(${probe}:*)` });
    assert.equal(allowed.output, 'loopback:ok');
    // Without unsandboxed commands the request is ignored and the command runs in the sandbox
    const ignored = await runClaude(join(dir, 'never'), {
        command: probe, toolInput, allowedTools: `Bash(${probe}:*)`, sandbox: { allowUnsandboxedCommands: false },
    });
    assert.equal(ignored.output, 'loopback:blocked');
});

test('the app runs Claude Code for a question: the agent calls the workbook with dashql, the next question resumes', async () => {
    const dir = caseDir('app');
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    const root = join(dir, 'agent');
    const input = join(root, 'workbooks', 'w1', 'input', 'orders.sql');
    // The agent lists the scripts, writes a script into the input folder and passes it to edit, tries a command that
    // the app does not allow, and answers. The second question gets an answer at once.
    const calls = [
        toolUse('Bash', { command: 'dashql scripts', description: 'list the scripts' }),
        toolUse('Write', { file_path: input, content: 'select count(*) from orders\n' }),
        toolUse('Bash', { command: 'dashql edit orders --file input/orders.sql', description: 'write the script' }),
        toolUse('Bash', { command: 'cat /etc/hostname', description: 'look around' }),
    ];
    const model = await startFakeAnthropic({
        turn: (_request, index) => index < calls.length ? [calls[index]] : [text(index === calls.length ? 'There are 42 orders.' : 'Per day too.')],
    });
    const app = startDashQLApp({
        root,
        env: {
            PATH: '/usr/bin:/bin',
            HOME: home,
            ANTHROPIC_BASE_URL: model.url,
            ANTHROPIC_API_KEY: 'sk-fake',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
            DISABLE_AUTOUPDATER: '1',
        },
        searchPath: [dirname(CLAUDE), '/usr/bin', '/bin'].join(':'),
        answer: call => call.command === 'scripts' ? 'orders.sql\n' : `${call.args.script}.sql changed\n`,
    });
    try {
        assert.deepEqual((await app.host.info()).harnesses.find(harness => harness.id === 'claude'), { id: 'claude', available: true });
        const first = await app.ask('w1', 'claude', 'How many orders?');
        // The page tells the dashql commands from their calls, the host leaves out the steps that ran them and wrote
        // their input. -p asks for nothing, a tool that the app does not allow is refused.
        assert.deepEqual(stepsOf(first), [{ status: 'cat /etc/hostname', failed: true }]);
        assert.deepEqual(first.at(-1), { event: 'Stop', message: 'There are 42 orders.', error: null });
        assert.deepEqual(app.page.calls.map(({ workbookId, command, args, input }) => ({ workbookId, command, args, input })), [
            { workbookId: 'w1', command: 'scripts', args: {}, input: null },
            { workbookId: 'w1', command: 'edit', args: { script: 'orders' }, input: 'select count(*) from orders\n' },
        ]);
        // The guide of dashql is in the system prompt of the main conversation
        assert.ok(model.requests.some(request => JSON.stringify(request.system ?? '').includes('dashql scripts')), 'the guide is in no system prompt');
        const state = JSON.parse(readFileSync(join(root, 'workbooks', 'w1', 'state.json'), 'utf8'));
        assert.equal(typeof state.sessions.claude, 'string');

        // The next question continues the conversation
        const second = await app.ask('w1', 'claude', 'And per day?');
        assert.deepEqual(second.at(-1), { event: 'Stop', message: 'Per day too.', error: null });
        const resumed = model.requests.filter(request => request.tools?.some(tool => tool.name === 'Bash')).at(-1);
        assert.ok(JSON.stringify(resumed.messages).includes('How many orders?'), 'the second question does not resume the first');
    } finally {
        await app.close();
        await model.close();
    }
});
