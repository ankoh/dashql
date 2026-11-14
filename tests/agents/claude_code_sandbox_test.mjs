// Where the sandbox of Claude Code ends, with a fake model and no model calls (docs/wip/agent_integration_tests.md).
// The model calls Bash with a probe that connects to a server on loopback, and the hooks run the same probe. The
// design of the live view relies on what this checks: inside the sandbox a command can't reach loopback, the hooks can.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { startFakeAnthropic, text, toolResults, toolUse } from './fake_anthropic.mjs';
import { readHookLog, requireLinuxSandboxTools, runHarness, startLoopbackTarget, writeHook, writeProbe } from './probes.mjs';

const CLAUDE = resolve(process.env.CLAUDE_BINARY);
const ROOT = mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'claude-code-'));
const HOOK_EVENTS = ['SessionStart', 'PostToolUse', 'Stop'];

let target;

before(async () => {
    requireLinuxSandboxTools(['bwrap', 'socat']);
    target = await startLoopbackTarget();
});

after(() => target?.close());

/// Run Claude Code headless with a fake model that calls the probe once, return the probe output and the hook lines
async function runProbe(name, sandbox) {
    const dir = join(ROOT, name);
    const home = join(dir, 'home');
    const work = join(dir, 'work');
    mkdirSync(home, { recursive: true });
    mkdirSync(work, { recursive: true });
    const probe = writeProbe(dir, target.port);
    const hook = writeHook(dir, probe);
    const model = await startFakeAnthropic({
        turn: request => toolResults(request).length === 0
            ? [toolUse('Bash', { command: probe, description: 'probe' })]
            : [text('done')],
    });
    const settings = {
        sandbox: { enabled: sandbox },
        hooks: Object.fromEntries(HOOK_EVENTS.map(event => [event, [{
            ...(event === 'PostToolUse' ? { matcher: '*' } : {}),
            hooks: [{ type: 'command', command: `${hook} ${event}` }],
        }]])),
    };
    try {
        const output = await runHarness(CLAUDE, [
            '-p', 'run the probe',
            '--output-format', 'stream-json', '--verbose',
            '--settings', JSON.stringify(settings),
            '--allowedTools', 'Bash',
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
        return { command: String(results[0].content).trim(), hooks: readHookLog(dir) };
    } finally {
        await model.close();
    }
}

test('a command in the sandbox cannot reach loopback, the hooks can', async () => {
    const { command, hooks } = await runProbe('sandbox', true);
    assert.equal(command, 'loopback:blocked');
    for (const event of HOOK_EVENTS) assert.ok(hooks.includes(`${event} loopback:ok`), `${event} in ${JSON.stringify(hooks)}`);
});

test('a command without the sandbox reaches loopback', async () => {
    const { command, hooks } = await runProbe('no_sandbox', false);
    assert.equal(command, 'loopback:ok');
    for (const event of HOOK_EVENTS) assert.ok(hooks.includes(`${event} loopback:ok`), `${event} in ${JSON.stringify(hooks)}`);
});
