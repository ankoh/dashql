// Where the sandbox of Codex ends, with a fake model and no model calls (docs/wip/agent_integration_tests.md).
// The model calls exec_command once, e.g. with a probe that connects to a server on loopback, hooks run the same probe
// or carry the events of the session to a server that a SessionStart hook started, and a prefix rule of the execution
// policy lets a command out of the sandbox.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { functionCall, functionCallOutputs, message, startFakeOpenAI } from './fake_openai.mjs';
import {
    readHookLog,
    requireLinuxSandboxTools,
    runHarness,
    startLoopbackTarget,
    stopSessionServer,
    writeBrokenScript,
    writeHook,
    writeProbe,
    writeSessionHook,
    writeSessionProbe,
} from './probes.mjs';

const CODEX = resolve(process.env.CODEX_BINARY);
const DASHQL = resolve(process.env.DASHQL_BINARY);
const ROOT = mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'codex-'));
const HOOK_EVENTS = ['SessionStart', 'PostToolUse', 'Stop'];

let target;

before(async () => {
    // Codex brings its own bubblewrap, it still needs unprivileged user namespaces
    requireLinuxSandboxTools([]);
    target = await startLoopbackTarget();
});

after(() => target?.close());

/// Run `codex exec` with a fake model that calls exec_command once
async function runCodex(dir, { command, sandbox = 'workspace-write', hook = null, allowPrefix = null, escalate = false }) {
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
    writeFileSync(join(codexHome, 'config.toml'), `model = "fake-model"
model_provider = "fake"

[model_providers.fake]
name = "fake"
base_url = "${model.url}/v1"
wire_api = "responses"
env_key = "FAKE_API_KEY"
`);
    if (hook != null) {
        writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify({
            hooks: Object.fromEntries(HOOK_EVENTS.map(event => [event, [{ hooks: [{ type: 'command', command: `${hook} ${event}` }] }]])),
        }));
    }
    if (allowPrefix != null) {
        writeFileSync(join(codexHome, 'rules', 'default.rules'), `prefix_rule(
    pattern = [${JSON.stringify(allowPrefix)}],
    decision = "allow",
)
`);
    }
    try {
        const output = await runHarness(CODEX, [
            'exec', '--skip-git-repo-check', '--json', '--sandbox', sandbox,
            // Codex skips user hooks until a user trusted them in /hooks
            ...(hook != null ? ['--dangerously-bypass-hook-trust'] : []),
            'run the probe',
        ], {
            cwd: work,
            env: { PATH: '/usr/bin:/bin', HOME: join(dir, 'home'), CODEX_HOME: codexHome, FAKE_API_KEY: 'fake' },
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

test('a command in workspace-write cannot reach loopback, the hooks can', async () => {
    const dir = caseDir('hooks');
    const probe = writeProbe(dir, target.port);
    const { commands } = await runCodex(dir, { command: probe, hook: writeHook(dir, probe) });
    assert.deepEqual(commands, ['loopback:blocked']);
    const hooks = readHookLog(dir);
    for (const event of HOOK_EVENTS) assert.ok(hooks.includes(`${event} loopback:ok`), `${event} in ${JSON.stringify(hooks)}`);
});

test('hooks run outside the sandbox in read-only too', async () => {
    const dir = caseDir('read_only_hooks');
    const probe = writeProbe(dir, target.port);
    await runCodex(dir, { command: probe, sandbox: 'read-only', hook: writeHook(dir, probe) });
    const hooks = readHookLog(dir);
    for (const event of HOOK_EVENTS) assert.ok(hooks.includes(`${event} loopback:ok`), `${event} in ${JSON.stringify(hooks)}`);
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

test('a server that SessionStart starts gets the events of the hooks, not the command', async () => {
    const dir = caseDir('session_server');
    const { commands } = await runCodex(dir, { command: writeSessionProbe(dir), hook: writeSessionHook(dir) });
    const { events, log } = stopSessionServer(dir);
    assert.deepEqual(commands, ['loopback:blocked']);
    for (const event of ['started', ...HOOK_EVENTS]) assert.ok(events.includes(event), `${event} in ${JSON.stringify(events)}, server: ${log}`);
});

test('dashql lint runs in workspace-write', async () => {
    const dir = caseDir('lint');
    mkdirSync(join(dir, 'work'));
    const { commands } = await runCodex(dir, { command: `${DASHQL} lint ${writeBrokenScript(join(dir, 'work'))}` });
    assert.equal(commands.length, 1);
    assert.match(commands[0], /expected a table reference after FROM/);
    assert.match(commands[0], /1 file, 1 error/);
});
