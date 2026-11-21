import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { connectedSessionStart, runSession } from './session_command.js';
import { startSessionServer } from './session_server.js';
import { runWith } from './test_process.js';

/// The folder that the harness works in, the server writes the address of the session there
const W = mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-workspace-'));
const SESSION = '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';

const hook = (event: string, payload: object, session = SESSION) =>
    runWith((args, cli) => runSession(args, cli), W, ['hook', event, '--harness', 'claude', '--workspace', W, '--session', session], JSON.stringify(payload));

describe('dashql session hook', () => {
    it('sends the events to the server of the session that its arguments name', async () => {
        const server = await startSessionServer({ harness: 'claude', folder: W, session: SESSION });
        try {
            const start = await hook('SessionStart', { session_id: 'c1', cwd: W });
            expect(start.code).toBe(0);
            // The start tells the agent the session that its commands take
            expect(start.stdout).toBe(connectedSessionStart('claude', W, SESSION));
            expect(start.stdout).toContain(`--workspace ${W} --session ${SESSION}`);
            await hook('UserPromptSubmit', { session_id: 'c1', cwd: W, prompt: 'how many orders' });
            // A shell that changed its directory still reaches the session
            await hook('PostToolUse', { session_id: 'c1', cwd: path.join(W, 'sub'), tool_name: 'Bash', tool_input: { command: 'dashql lint a.sql' } });
            await hook('Stop', { session_id: 'c1', cwd: W, last_assistant_message: '42' });
            expect(server.state()).toMatchObject({
                id: SESSION,
                harness: 'claude',
                folder: W,
                turns: [{ turnId: 1, question: 'how many orders', status: null, note: '42', files: ['a.sql'] }],
            });
        } finally {
            await server.close();
        }
    });

    it('never fails the harness', async () => {
        // No server of the session, an unknown event, a hook without its session
        const gone = await hook('SessionEnd', { session_id: 'gone' });
        expect(gone.code).toBe(0);
        expect(gone.stderr).toBe(`dashql: the session ${SESSION} does not run in ${W}\n`);
        expect((await hook('Notification', {})).code).toBe(0);
        const bare = await runWith((args, cli) => runSession(args, cli), W, ['hook', 'Stop', '--harness', 'claude'], '{}');
        expect(bare.code).toBe(0);
        expect(bare.stderr).toContain('--workspace and --session name the session of dashql connect');
        const noHarness = await runWith((args, cli) => runSession(args, cli), W, ['hook', 'Stop', '--workspace', W, '--session', SESSION], '{}');
        expect(noHarness.code).toBe(0);
        expect(noHarness.stderr).toContain('--harness names the harness of the hook');
    });
});
