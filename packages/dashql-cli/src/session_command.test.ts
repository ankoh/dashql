import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { connectedSessionStart, runSession } from './session_command.js';
import { startSessionServer } from './session_server.js';
import { runWith } from './test_process.js';

/// The folder that the harness works in, the server writes the address of the session into its workspace
const W = mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-workspace-'));
/// The workspace of the session, the .dashql/ of the folder
const WS = path.join(W, '.dashql');
const SESSION = '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';

const hook = (event: string, payload: object, workspace = WS) =>
    runWith((args, cli) => runSession(args, cli), workspace, ['hook', event, '--harness', 'claude', '--workspace', workspace], JSON.stringify(payload));

describe('dashql session hook', () => {
    it('sends the events to the server of the session that its arguments name', async () => {
        const server = await startSessionServer({ harness: 'claude', folder: W, session: SESSION });
        try {
            const start = await hook('SessionStart', { session_id: 'c1', cwd: W });
            expect(start.code).toBe(0);
            // The start tells the agent the copies and the workspace
            expect(start.stdout).toBe(connectedSessionStart('claude', WS, W));
            expect(start.stdout).toContain(`dashql run ${WS}/workbooks/<id>`);
            expect(start.stdout).toContain(`dashql describe --workspace ${WS}`);
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
        expect(gone.stderr).toBe(`dashql: no session of dashql connect runs in ${WS}\n`);
        expect((await hook('Notification', {})).code).toBe(0);
        const bare = await runWith((args, cli) => runSession(args, cli), W, ['hook', 'Stop', '--harness', 'claude'], '{}');
        expect(bare.code).toBe(0);
        expect(bare.stderr).toContain('--workspace names the workspace of the session of dashql connect');
        const noHarness = await runWith((args, cli) => runSession(args, cli), W, ['hook', 'Stop', '--workspace', WS], '{}');
        expect(noHarness.code).toBe(0);
        expect(noHarness.stderr).toContain('--harness names the harness of the hook');
    });
});
