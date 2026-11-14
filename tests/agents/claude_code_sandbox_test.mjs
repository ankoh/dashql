// Where the sandbox of Claude Code ends, with a fake model and no model calls (docs/wip/agent_integration_tests.md).
// The model calls Bash with a probe that connects to a server on loopback, and the hooks run the same probe. The
// design of the live view relies on what this checks: inside the sandbox a command can't reach loopback, the hooks can.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { startFakeAnthropic, text, toolResults, toolUse } from './fake_anthropic.mjs';

const CLAUDE = resolve(process.env.CLAUDE_BINARY);
const ROOT = mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'claude-code-'));
const HOOK_EVENTS = ['SessionStart', 'PostToolUse', 'Stop'];

let target;

before(async () => {
    if (process.platform === 'linux') {
        for (const tool of ['bwrap', 'socat']) {
            assert.ok(['/usr/bin', '/bin', '/usr/local/bin'].some(dir => existsSync(join(dir, tool))),
                `the sandbox of Claude Code on Linux needs ${tool} (apt install bubblewrap socat)`);
        }
    }
    // The server that the probes connect to
    target = net.createServer(socket => socket.end());
    await new Promise(done => target.listen(0, '127.0.0.1', done));
});

after(() => target?.close());

/// A script that prints `loopback:ok` or `loopback:blocked`
function writeProbe(dir) {
    const probe = join(dir, 'probe.sh');
    writeFileSync(probe, `#!/bin/bash
if (exec 3<>/dev/tcp/127.0.0.1/${target.address().port}) 2>/dev/null; then echo loopback:ok; else echo loopback:blocked; fi
`);
    chmodSync(probe, 0o755);
    return probe;
}

/// A hook that appends `<event> <probe output>` to hooks.log
function writeHook(dir, probe) {
    const hook = join(dir, 'hook.sh');
    writeFileSync(hook, `#!/bin/bash
echo "$1 $(${probe})" >> ${join(dir, 'hooks.log')}
`);
    chmodSync(hook, 0o755);
    return hook;
}

/// Run Claude Code headless with a fake model that calls the probe once, return the probe output and the hook lines
async function runProbe(name, sandbox) {
    const dir = join(ROOT, name);
    const home = join(dir, 'home');
    const work = join(dir, 'work');
    mkdirSync(home, { recursive: true });
    mkdirSync(work, { recursive: true });
    const probe = writeProbe(dir);
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
        const output = await new Promise((done, fail) => {
            const child = spawn(CLAUDE, [
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
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', chunk => { stdout += chunk; });
            child.stderr.on('data', chunk => { stderr += chunk; });
            const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
            child.on('error', fail);
            child.on('close', code => {
                clearTimeout(timer);
                if (code === 0) done(stdout);
                else fail(new Error(`claude exited with ${code}: ${stderr.slice(-2000)}`));
            });
        });
        const results = output.split('\n').filter(Boolean).map(line => JSON.parse(line))
            .flatMap(event => event.type === 'user' && Array.isArray(event.message?.content) ? event.message.content : [])
            .filter(block => block.type === 'tool_result');
        assert.equal(results.length, 1, `one tool result, got ${JSON.stringify(results)}`);
        const log = join(dir, 'hooks.log');
        const hooks = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
        return { command: String(results[0].content).trim(), hooks };
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
