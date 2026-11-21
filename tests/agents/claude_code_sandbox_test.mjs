// Where the sandbox of Claude Code ends, with a fake model and no model calls (docs/design/agent_integration_tests.md).
// The model calls Bash once, e.g. with a probe that connects to a server on loopback, and hooks run the same probe or
// carry the events of the session to a server that a SessionStart hook started.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { startFakeAnthropic, text, toolResults, toolUse } from './fake_anthropic.mjs';
import {
    followDashQLSession,
    freePort,
    readHookLog,
    requireLinuxSandboxTools,
    runHarness,
    startLoopbackTarget,
    stopSessionServer,
    writeBrokenScript,
    writeDashQLCommand,
    writeHook,
    writeProbe,
    writeSessionHook,
    writeSessionProbe,
} from './probes.mjs';

const CLAUDE = resolve(process.env.CLAUDE_BINARY);
const ROOT = mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'claude-code-'));
const DASHQL = writeDashQLCommand(ROOT);
const HOOK_EVENTS = ['SessionStart', 'PostToolUse', 'Stop'];

let target;

before(async () => {
    requireLinuxSandboxTools(['bwrap', 'socat']);
    target = await startLoopbackTarget();
});

after(() => target?.close());

/// Run Claude Code headless with a fake model that calls Bash once, return the tool result
async function runClaude(dir, { command, toolInput = {}, sandbox = {}, allowedTools = 'Bash', hook = null, hookEvents = HOOK_EVENTS, env = {} }) {
    const home = join(dir, 'home');
    const work = join(dir, 'work');
    mkdirSync(home, { recursive: true });
    mkdirSync(work, { recursive: true });
    const model = await startFakeAnthropic({
        turn: request => toolResults(request).length === 0
            ? [toolUse('Bash', { command, description: 'probe', ...toolInput })]
            : [text('done')],
    });
    const settings = {
        sandbox: { enabled: true, ...sandbox },
        ...(hook == null ? {} : {
            hooks: Object.fromEntries(hookEvents.map(event => [event, [{
                ...(event === 'PreToolUse' || event === 'PostToolUse' ? { matcher: '*' } : {}),
                hooks: [{ type: 'command', command: hook.includes('{event}') ? hook.replaceAll('{event}', event) : `${hook} ${event}` }],
            }]])),
        }),
    };
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

test('a command in the sandbox cannot reach loopback, the hooks can', async () => {
    const dir = caseDir('sandbox');
    const probe = writeProbe(dir, target.port);
    const { output } = await runClaude(dir, { command: probe, hook: writeHook(dir, probe) });
    assert.equal(output, 'loopback:blocked');
    const hooks = readHookLog(dir);
    for (const event of HOOK_EVENTS) assert.ok(hooks.includes(`${event} loopback:ok`), `${event} in ${JSON.stringify(hooks)}`);
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

test('a server that SessionStart starts gets the events of the hooks, not the command', async () => {
    const dir = caseDir('session_server');
    const { output } = await runClaude(dir, { command: writeSessionProbe(dir), hook: writeSessionHook(dir) });
    const { events, log } = stopSessionServer(dir);
    assert.equal(output, 'loopback:blocked');
    for (const event of ['started', ...HOOK_EVENTS]) assert.ok(events.includes(event), `${event} in ${JSON.stringify(events)}, server: ${log}`);
});

test('dashql lint runs in the sandbox', async () => {
    const dir = caseDir('lint');
    mkdirSync(join(dir, 'work'));
    const { output } = await runClaude(dir, { command: `${DASHQL} lint ${writeBrokenScript(join(dir, 'work'))}` });
    assert.match(output, /expected a table reference after FROM/);
    assert.match(output, /1 file, 1 error/);
});

/// The environment of Claude Code with the fake model, PATH without a dashql: connect puts its own in front
function claudeEnv(home, model) {
    return {
        PATH: '/usr/bin:/bin',
        HOME: home,
        ANTHROPIC_BASE_URL: model.url,
        ANTHROPIC_API_KEY: 'sk-fake',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_AUTOUPDATER: '1',
    };
}

test('the hooks of dashql connect show the session in DashQL: the question, what the agent ran and its answer', async () => {
    const dir = caseDir('dashql_session');
    const home = join(dir, 'home');
    const work = join(dir, 'work');
    mkdirSync(home, { recursive: true });
    mkdirSync(work, { recursive: true });
    const model = await startFakeAnthropic({
        turn: request => toolResults(request).length === 0
            ? [toolUse('Bash', { command: 'echo hello from scripts/orders.sql', description: 'probe' })]
            : [text('done')],
    });
    const port = await freePort();
    try {
        const following = followDashQLSession(port, 's3cret');
        await runHarness(DASHQL, [
            'connect', '--launch', 'claude', '--command', CLAUDE, '--port', String(port), '--secret', 's3cret',
            '--', '-p', 'run the probe', '--output-format', 'stream-json', '--verbose', '--allowedTools', 'Bash',
        ], { cwd: work, env: claudeEnv(home, model) });
        const state = await following;
        assert.equal(state.harness, 'claude');
        assert.equal(state.ended, true);
        // A step starts with PreToolUse and ends with the PostToolUse of the same tool use id
        const steps = state.turns.flatMap(turn => turn.steps);
        assert.equal(steps.length, 1, JSON.stringify(steps));
        assert.equal(typeof steps[0].toolUseId, 'string');
        assert.ok(steps[0].startedAt <= steps[0].endedAt, JSON.stringify(steps));
        assert.deepEqual(state.turns.map(({ steps, ...turn }) => ({ ...turn, steps: steps.map(({ label, failed }) => ({ label, failed })) })), [{
            turnId: 1,
            question: 'run the probe',
            status: null,
            waiting: null,
            interrupted: false,
            note: 'done',
            files: ['scripts/orders.sql'],
            steps: [{ label: 'echo hello from scripts/orders.sql', failed: false }],
        }]);
    } finally {
        await model.close();
    }
});

test('dashql connect gives Claude Code the guide of DashQL and lets it run dashql and edit the workbooks without asking', async () => {
    const dir = caseDir('connect');
    const home = join(dir, 'home');
    const work = join(dir, 'work');
    mkdirSync(home, { recursive: true });
    // A workbook folder of the project, outside of the session
    mkdirSync(join(work, 'mine', 'scripts'), { recursive: true });
    writeFileSync(join(work, 'mine', 'dashql-workbook.json'), JSON.stringify({ name: 'Mine', connections: [], scripts: [] }));
    // The model runs dashql, runs the workbook of the project, tries to make it a workspace of its own and run it there,
    // writes a script of a copy and checks it, and writes a file of the project, one after the other. The folder of the
    // session goes with the session, the lint reads the script.
    const script = join(work, '.dashql', 'session', 'workbooks', 'w1', 'scripts', 'orders.sql');
    const calls = [
        toolUse('Bash', { command: `dashql describe --workspace ${work}`, description: 'read the guide' }),
        toolUse('Bash', { command: `dashql run --workspace ${work} mine`, description: 'run the workbook of the project' }),
        toolUse('Bash', { command: 'dashql init mine', description: 'set up the workbook of the project' }),
        toolUse('Bash', { command: 'dashql run --workspace mine mine', description: 'run it in its own workspace' }),
        toolUse('Write', { file_path: script, content: 'select 1\n' }),
        toolUse('Bash', { command: `dashql lint ${script}`, description: 'check the script' }),
        toolUse('Write', { file_path: join(work, 'notes.md'), content: 'notes\n' }),
    ];
    const model = await startFakeAnthropic({
        turn: request => {
            const results = (request.messages ?? []).flatMap(message => Array.isArray(message.content) ? message.content : []).filter(block => block.type === 'tool_result');
            return results.length < calls.length ? [calls[results.length]] : [text('done')];
        },
    });
    const port = await freePort();
    try {
        // No --allowedTools: a tool that the settings of dashql connect don't allow needs an approval, which -p never gives
        const output = await runHarness(DASHQL, [
            'connect', '--launch', 'claude', '--command', CLAUDE, '--port', String(port), '--secret', 's3cret',
            '--', '-p', 'how many orders', '--output-format', 'stream-json', '--verbose',
        ], { cwd: work, env: claudeEnv(home, model) });
        const results = output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
            .flatMap(event => event.type === 'user' && Array.isArray(event.message?.content) ? event.message.content : [])
            .filter(block => block.type === 'tool_result');
        assert.equal(results.length, 7, JSON.stringify(results));
        const content = result => Array.isArray(result.content) ? result.content.map(block => block.text ?? '').join('') : String(result.content);
        // dashql runs without asking, from the dashql that connect puts on the path
        assert.equal(results[0].is_error === true, false, content(results[0]));
        assert.match(content(results[0]), /^DashQL works on workbooks/);
        // While the session runs in the workspace, dashql runs nothing outside its tab
        assert.equal(results[1].is_error, true, content(results[1]));
        assert.match(content(results[1]), /mine is no copy of a workbook of the tab of DashQL and would run outside the tab/);
        assert.equal(existsSync(join(work, '.dashql', 'cache')), false);
        // Only the user sets up a workspace: dashql init needs an approval, and the folder that it did not set up is no
        // workspace to run in
        assert.equal(results[2].is_error, true, content(results[2]));
        assert.equal(existsSync(join(work, 'mine', '.dashql')), false);
        assert.equal(results[3].is_error, true, content(results[3]));
        assert.match(content(results[3]), /mine is no workspace of DashQL/);
        // A script of the copy is written without asking, a file of the project needs an approval
        assert.equal(results[4].is_error === true, false, content(results[4]));
        assert.match(content(results[5]), /1 file, 0 errors/);
        assert.equal(results[6].is_error, true, content(results[6]));
        assert.equal(existsSync(join(work, '.dashql', 'session')), false);
        assert.equal(existsSync(join(work, 'notes.md')), false);
        // The guide is in the system prompt of the main conversation
        assert.ok(model.requests.some(request => JSON.stringify(request.system ?? '').includes('The user started you from DashQL')), 'the guide is in no system prompt');
    } finally {
        await model.close();
    }
});
