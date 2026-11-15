import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { followAgentSession } from '@ankoh/dashql-runtime/session/agent_session_client';
import type { AgentSessionState } from '@ankoh/dashql-runtime/session/agent_session_state';

import { claudeHookArgs, codexHookArgs, CONNECT_USAGE, runConnect, shellWord, type ConnectEnvironment } from './connect_command.js';
import { runSession, SESSION_ENDPOINT_ENV, SESSION_TOKEN_ENV, type SessionEnvironment } from './session_command.js';
import { runWith } from './test_process.js';

/// The folder of the session, the server writes its journal there
const W = mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-connect-'));
/// dashql as the hooks call it
const DASHQL = ['/usr/bin/node', '/opt/dash ql/dashql.js'];

/// A port that is free right now
async function freePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>(resolve => server.close(() => resolve()));
    return port;
}

/// The environment of a hook, the harness passes its own on
function hookEnvironment(harnessEnv: Record<string, string>): SessionEnvironment {
    const endpoint = harnessEnv[SESSION_ENDPOINT_ENV];
    const token = harnessEnv[SESSION_TOKEN_ENV];
    return {
        servers: mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-servers-')),
        home: null,
        appUrl: 'http://localhost:9002',
        startServer: () => { throw new Error('a connected hook starts no server'); },
        connected: endpoint != null && token != null ? { endpoint, token } : null,
    };
}

/// Run a hook command of the harness: the words after dashql, as the shell splits them
function runHook(command: string, harnessEnv: Record<string, string>, payload: object) {
    const prefix = `${DASHQL.map(shellWord).join(' ')} `;
    expect(command.startsWith(prefix)).toBe(true);
    const [, ...args] = command.slice(prefix.length).split(' ');
    return runWith((a, cli) => runSession(a, cli, hookEnvironment(harnessEnv)), W, args, JSON.stringify(payload));
}

/// A connect environment whose harness is a function of the test
function connectEnvironment(harness: ConnectEnvironment['runHarness']): ConnectEnvironment {
    return { home: null, dashql: DASHQL, runHarness: harness };
}

const connect = (env: ConnectEnvironment, args: string[]) => runWith((a, cli) => runConnect(a, cli, env), W, args);

describe('dashql connect', () => {
    it('runs Claude Code with the hooks that send its events to the server on the port and secret of the page', async () => {
        const port = await freePort();
        const states: AgentSessionState[] = [];
        let following: Promise<void> | null = null;
        let program = '';
        let args: string[] = [];
        const env = connectEnvironment(async (harnessProgram, harnessArgs, harnessEnv, cwd) => {
            program = harnessProgram;
            args = harnessArgs;
            expect(cwd).toBe(W);
            expect(harnessEnv).toEqual({ [SESSION_ENDPOINT_ENV]: `http://127.0.0.1:${port}`, [SESSION_TOKEN_ENV]: 's3cret' });
            // The page follows the server like the tab that showed the line
            following = followAgentSession({ endpoint: `http://127.0.0.1:${port}`, token: 's3cret' }, state => states.push(state), new AbortController().signal);
            const { hooks } = JSON.parse(harnessArgs[harnessArgs.indexOf('--settings') + 1]);
            const command = (event: string) => hooks[event][0].hooks[0].command as string;
            const start = await runHook(command('SessionStart'), harnessEnv, { session_id: 'c1', cwd: W });
            expect(start.stdout).toBe('DashQL shows this session live\n');
            await runHook(command('UserPromptSubmit'), harnessEnv, { session_id: 'c1', cwd: W, prompt: 'how many orders' });
            await runHook(command('PostToolUse'), harnessEnv, { session_id: 'c1', cwd: W, tool_name: 'Bash', tool_input: { command: 'dashql lint a.sql' } });
            await runHook(command('Stop'), harnessEnv, { session_id: 'c1', cwd: W, last_assistant_message: '42' });
            // Hooks in the settings of the harness stay quiet, the hooks of connect send the events
            await runWith((a, cli) => runSession(a, cli, hookEnvironment(harnessEnv)), W, ['hook', 'UserPromptSubmit', '--harness', 'claude'], JSON.stringify({ prompt: 'twice' }));
            return 3;
        });
        const output = await connect(env, ['--launch', 'claude', '--port', String(port), '--secret', 's3cret', '--', '--model', 'opus']);
        expect(output).toEqual({ code: 3, stdout: `DashQL follows this session on 127.0.0.1:${port}\n`, stderr: '' });
        expect(program).toBe('claude');
        expect(args.slice(-2)).toEqual(['--model', 'opus']);
        // The server ends the stream once the harness exited
        await following;
        expect(states[states.length - 1]).toMatchObject({
            harness: 'claude',
            folder: W,
            ended: true,
            turns: [{ turnId: 1, question: 'how many orders', note: '42', files: ['a.sql'] }],
        });
        // The server is gone
        await expect(fetch(`http://127.0.0.1:${port}/v1/state`)).rejects.toThrow();
    });

    it('gives Codex the hooks as a config override, without SessionEnd', () => {
        const [flag, value] = codexHookArgs(DASHQL);
        expect(flag).toBe('-c');
        expect(value.startsWith('hooks={SessionStart=[{hooks=[{type="command",command="/usr/bin/node \'/opt/dash ql/dashql.js\' session hook SessionStart --harness codex --connected"}]}],')).toBe(true);
        expect(value).toContain('Stop=[');
        expect(value).not.toContain('SessionEnd');
        const [settingsFlag, settings] = claudeHookArgs(DASHQL);
        expect(settingsFlag).toBe('--settings');
        expect(JSON.parse(settings).hooks.PostToolUse[0].matcher).toBe('*');
    });

    it('fails on a port that is taken and on a harness that is missing', async () => {
        const taken: Server = createServer();
        await new Promise<void>(resolve => taken.listen(0, '127.0.0.1', () => resolve()));
        const port = (taken.address() as { port: number }).port;
        try {
            let ran = false;
            const busy = await connect(connectEnvironment(async () => { ran = true; return 0; }), ['--launch', 'codex', '--port', String(port), '--secret', 's']);
            expect(busy).toEqual({ code: 1, stdout: '', stderr: `dashql: port ${port} is taken, get a new line in DashQL\n` });
            expect(ran).toBe(false);
        } finally {
            await new Promise<void>(resolve => taken.close(() => resolve()));
        }
        const missing = await connect(connectEnvironment(() => Promise.reject(Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }))), ['--launch', 'codex', '--port', String(await freePort()), '--secret', 's']);
        expect(missing.code).toBe(1);
        expect(missing.stderr).toBe('dashql: cannot run codex, is Codex installed?\n');
    });

    it('checks its arguments', async () => {
        const env = connectEnvironment(() => Promise.resolve(0));
        for (const args of [[], ['--port', '1', '--secret', 's'], ['--launch', 'cursor', '--port', '1', '--secret', 's'], ['--launch', 'claude', '--secret', 's'], ['--launch', 'claude', '--port', '70000', '--secret', 's'], ['--launch', 'claude', '--port', '1'], ['claude', '--launch', 'claude', '--port', '1', '--secret', 's']]) {
            const output = await connect(env, args);
            expect(output.code, args.join(' ')).toBe(2);
            expect(output.stderr.endsWith(`${CONNECT_USAGE}\n`), args.join(' ')).toBe(true);
        }
        expect((await connect(env, ['--help'])).stdout).toBe(`${CONNECT_USAGE}\n`);
    });

    it('leaves a hook of connect quiet outside of connect', async () => {
        const output = await runWith((a, cli) => runSession(a, cli, hookEnvironment({})), W, ['hook', 'SessionStart', '--harness', 'claude', '--connected'], '{}');
        expect(output).toEqual({ code: 0, stdout: '', stderr: '' });
    });
});
