// Where the sandbox of Claude Code ends, with a fake model and no model calls (docs/wip/agent_integration_tests.md).
// The model calls Bash once, e.g. with a probe that connects to a server on loopback, and hooks run the same probe or
// carry the events of the session to a server that a SessionStart hook started.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { startFakeAnthropic, text, toolResults, toolUse } from './fake_anthropic.mjs';
import {
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
async function runClaude(dir, { command, toolInput = {}, sandbox = {}, allowedTools = 'Bash', hook = null }) {
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
            hooks: Object.fromEntries(HOOK_EVENTS.map(event => [event, [{
                ...(event === 'PostToolUse' ? { matcher: '*' } : {}),
                hooks: [{ type: 'command', command: `${hook} ${event}` }],
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
