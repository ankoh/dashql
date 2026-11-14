// Where the sandbox of Codex ends, with a fake model and no model calls (docs/wip/agent_integration_tests.md).
// The model calls exec_command with a probe that connects to a server on loopback, hooks run the same probe, and a
// prefix rule of the execution policy lets the probe out of the sandbox.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { functionCall, functionCallOutputs, message, startFakeOpenAI } from './fake_openai.mjs';
import { readHookLog, requireLinuxSandboxTools, runHarness, startLoopbackTarget, writeHook, writeProbe } from './probes.mjs';

const CODEX = resolve(process.env.CODEX_BINARY);
const ROOT = mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'codex-'));
const HOOK_EVENTS = ['SessionStart', 'PostToolUse', 'Stop'];

let target;

before(async () => {
    // Codex brings its own bubblewrap, it still needs unprivileged user namespaces
    requireLinuxSandboxTools([]);
    target = await startLoopbackTarget();
});

after(() => target?.close());

/// Run `codex exec` with a fake model that calls the probe through exec_command once
async function runProbe(name, { sandbox = 'workspace-write', hooks = false, allowRule = false, escalate = false } = {}) {
    const dir = join(ROOT, name);
    const codexHome = join(dir, 'codex');
    const work = join(dir, 'work');
    mkdirSync(join(codexHome, 'rules'), { recursive: true });
    mkdirSync(work, { recursive: true });
    const probe = writeProbe(dir, target.port);
    const model = await startFakeOpenAI({
        turn: request => functionCallOutputs(request).length === 0
            ? [functionCall('exec_command', {
                cmd: probe,
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
    if (hooks) {
        const hook = writeHook(dir, probe);
        writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify({
            hooks: Object.fromEntries(HOOK_EVENTS.map(event => [event, [{ hooks: [{ type: 'command', command: `${hook} ${event}` }] }]])),
        }));
    }
    if (allowRule) {
        writeFileSync(join(codexHome, 'rules', 'default.rules'), `prefix_rule(
    pattern = [${JSON.stringify(probe)}],
    decision = "allow",
)
`);
    }
    try {
        const output = await runHarness(CODEX, [
            'exec', '--skip-git-repo-check', '--json', '--sandbox', sandbox,
            // Codex skips user hooks until a user trusted them in /hooks
            ...(hooks ? ['--dangerously-bypass-hook-trust'] : []),
            'run the probe',
        ], {
            cwd: work,
            env: { PATH: '/usr/bin:/bin', HOME: join(dir, 'home'), CODEX_HOME: codexHome, FAKE_API_KEY: 'fake' },
        });
        const commands = output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
            .filter(event => event.type === 'item.completed' && event.item?.type === 'command_execution')
            .map(event => event.item.aggregated_output.trim());
        const outputs = model.requests.flatMap(functionCallOutputs).map(item => String(item.output));
        return { commands, outputs, hooks: readHookLog(dir) };
    } finally {
        await model.close();
    }
}

test('a command in workspace-write cannot reach loopback, the hooks can', async () => {
    const { commands, hooks } = await runProbe('hooks', { hooks: true });
    assert.deepEqual(commands, ['loopback:blocked']);
    for (const event of HOOK_EVENTS) assert.ok(hooks.includes(`${event} loopback:ok`), `${event} in ${JSON.stringify(hooks)}`);
});

test('hooks run outside the sandbox in read-only too', async () => {
    const { hooks } = await runProbe('read_only_hooks', { sandbox: 'read-only', hooks: true });
    for (const event of HOOK_EVENTS) assert.ok(hooks.includes(`${event} loopback:ok`), `${event} in ${JSON.stringify(hooks)}`);
});

test('a command that an allow rule matches runs outside the sandbox', async () => {
    const { commands } = await runProbe('allow_rule', { allowRule: true });
    assert.deepEqual(commands, ['loopback:ok']);
});

test('codex exec rejects a request to escalate, with or without a rule', async () => {
    for (const allowRule of [false, true]) {
        const { commands, outputs } = await runProbe(`escalate_${allowRule}`, { escalate: true, allowRule });
        assert.deepEqual(commands, []);
        assert.ok(outputs.some(output => output.includes('approval policy is Never')), JSON.stringify(outputs));
    }
});
