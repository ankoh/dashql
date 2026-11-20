import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { followAgentSession } from '@akohn/dashql/platform/session/agent_session_client';
import type { AgentSessionState } from '@akohn/dashql/platform/session/agent_session_state';

import { CLAUDE_ALLOWED_TOOLS, claudeHookArgs, codexHookArgs, CONNECT_USAGE, runConnect, type ConnectEnvironment, type HookSession } from './connect_command.js';
import { CONNECTED_AGENT_GUIDE, DESCRIBE_TEXT } from './describe_command.js';
import { connectedSessionStart, connectedSessionStartText, runSession, shellWord } from './session_command.js';
import { runWith } from './test_process.js';

/// The folder that the harness works in, the server keeps the folder of its session there
const W = mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-connect-'));
/// The id of the session that connect picks in the tests
const SESSION = '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';
const HOOK_SESSION: HookSession = { workspace: W, session: SESSION };
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

/// Run a hook command of the harness: the words after dashql, as the shell splits them
function runHook(command: string, payload: object) {
    const prefix = `${DASHQL.map(shellWord).join(' ')} `;
    expect(command.startsWith(prefix)).toBe(true);
    const [, ...args] = command.slice(prefix.length).split(' ');
    return runWith((a, cli) => runSession(a, cli), W, args, JSON.stringify(payload));
}

/// A connect environment whose harness is a function of the test
function connectEnvironment(harness: ConnectEnvironment['runHarness']): ConnectEnvironment {
    return { dashql: DASHQL, searchPath: '/usr/bin', posix: true, sessionId: () => SESSION, runHarness: harness };
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
            const bin = path.join(W, '.dashql', 'sessions', SESSION, 'bin');
            // The session goes to the harness in the arguments of the hooks, the environment has only the dashql of
            // the agent
            expect(harnessEnv).toEqual({ PATH: `${bin}:/usr/bin` });
            // The commands of the agent find the server in the folder of the session
            expect(JSON.parse(readFileSync(path.join(W, '.dashql', 'sessions', SESSION, 'server.json'), 'utf8'))).toEqual({ endpoint: `http://127.0.0.1:${port}`, token: 's3cret' });
            // The agent runs dashql like the hooks
            expect(readFileSync(path.join(bin, 'dashql'), 'utf8')).toBe(`#!/bin/sh\nexec /usr/bin/node '/opt/dash ql/dashql.js' "$@"\n`);
            expect(statSync(path.join(bin, 'dashql')).mode & 0o111).not.toBe(0);
            // The page follows the server like the tab that showed the line
            following = followAgentSession({ endpoint: `http://127.0.0.1:${port}`, token: 's3cret' }, state => states.push(state), new AbortController().signal);
            const { hooks } = JSON.parse(harnessArgs[harnessArgs.indexOf('--settings') + 1]);
            const command = (event: string) => hooks[event][0].hooks[0].command as string;
            expect(command('SessionStart')).toContain(` --workspace ${W} --session ${SESSION}`);
            const start = await runHook(command('SessionStart'), { session_id: 'c1', cwd: W });
            // Claude Code has the guide in its system prompt, the hook tells the session and the workbooks of the folder
            expect(start.stdout).toBe(`${connectedSessionStartText(W, SESSION)}\n\nWorkbooks of DashQL in this session: none yet. The tab of DashQL copies the workbook that it shows into the
session once it reaches it.
`);
            expect(start.stdout).toBe(connectedSessionStart('claude', W, SESSION));
            expect(harnessArgs[harnessArgs.indexOf('--append-system-prompt') + 1]).toBe(CONNECTED_AGENT_GUIDE);
            // The agent runs dashql and edits the copies without asking
            expect(JSON.parse(harnessArgs[harnessArgs.indexOf('--settings') + 1]).permissions).toEqual({ allow: CLAUDE_ALLOWED_TOOLS });
            await runHook(command('UserPromptSubmit'), { session_id: 'c1', cwd: W, prompt: 'how many orders' });
            await runHook(command('PostToolUse'), { session_id: 'c1', cwd: W, tool_name: 'Bash', tool_input: { command: 'dashql lint a.sql' } });
            await runHook(command('Stop'), { session_id: 'c1', cwd: W, last_assistant_message: '42' });
            return 3;
        });
        const output = await connect(env, ['--launch', 'claude', '--port', String(port), '--secret', 's3cret', '--', '--model', 'opus']);
        expect(output).toEqual({ code: 3, stdout: `DashQL follows this session on 127.0.0.1:${port}\n`, stderr: '' });
        expect(program).toBe('claude');
        expect(args.slice(-2)).toEqual(['--model', 'opus']);
        // The server ends the stream once the harness exited
        await following;
        expect(states[states.length - 1]).toMatchObject({
            id: SESSION,
            harness: 'claude',
            folder: W,
            ended: true,
            turns: [{ turnId: 1, question: 'how many orders', note: '42', files: ['a.sql'] }],
        });
        // The server is gone, with the folder of its session
        await expect(fetch(`http://127.0.0.1:${port}/v1/state`)).rejects.toThrow();
        expect(existsSync(path.join(W, '.dashql', 'sessions', SESSION))).toBe(false);
    });

    it('gives Codex the guide at the start of the session', () => {
        const start = connectedSessionStart('codex', W, SESSION);
        expect(start.startsWith(`${CONNECTED_AGENT_GUIDE}\n\n${connectedSessionStartText(W, SESSION)}\n\n`)).toBe(true);
        expect(CONNECTED_AGENT_GUIDE.endsWith(DESCRIBE_TEXT)).toBe(true);
        expect(codexHookArgs(DASHQL, HOOK_SESSION)).not.toContain('--append-system-prompt');
    });

    it('gives Codex the hooks as a config override, without SessionEnd', () => {
        const [flag, value] = codexHookArgs(DASHQL, HOOK_SESSION);
        expect(flag).toBe('-c');
        expect(value.startsWith(`hooks={SessionStart=[{hooks=[{type="command",command="/usr/bin/node '/opt/dash ql/dashql.js' session hook SessionStart --harness codex --workspace ${W} --session ${SESSION}"}]}],`)).toBe(true);
        expect(value).toContain('Stop=[');
        expect(value).not.toContain('SessionEnd');
        const [settingsFlag, settings] = claudeHookArgs(DASHQL, HOOK_SESSION);
        expect(settingsFlag).toBe('--settings');
        const hooks = JSON.parse(settings).hooks;
        for (const event of ['PreToolUse', 'PostToolUse', 'PostToolUseFailure']) expect(hooks[event][0].matcher).toBe('*');
        expect(value).toContain('PreToolUse=[');
        expect(value).not.toContain('PostToolUseFailure');
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

});
