import { lastAssistantText, sessionEventOf } from './session_hook.js';

describe('the events of the hooks of a harness', () => {
    it('reads the question, the tools and the final message of Claude Code', () => {
        expect(sessionEventOf('UserPromptSubmit', 'claude', { cwd: '/w', prompt: 'how many orders' }))
            .toEqual({ event: 'UserPromptSubmit', harness: 'claude', folder: '/w', prompt: 'how many orders' });
        expect(sessionEventOf('PostToolUse', 'claude', { cwd: '/w', tool_name: 'Bash', tool_input: { command: 'dashql lint scripts/a.sql b.sql\nmore' } }))
            .toMatchObject({ status: 'dashql lint scripts/a.sql b.sql', files: ['scripts/a.sql', 'b.sql'] });
        expect(sessionEventOf('PostToolUse', 'claude', { tool_name: 'Edit', tool_input: { file_path: '/w/scripts/a.sql' } }))
            .toMatchObject({ status: 'Edit /w/scripts/a.sql', files: ['/w/scripts/a.sql'] });
        const transcript = [
            JSON.stringify({ type: 'user', message: { content: 'q' } }),
            JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } }),
            JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }),
            JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'There are' }, { type: 'text', text: '42' }] } }),
            'not json',
        ].join('\n');
        expect(lastAssistantText(transcript)).toBe('There are\n42');
        expect(sessionEventOf('Stop', 'claude', { cwd: '/w', transcript_path: '/t.jsonl' }, () => transcript))
            .toEqual({ event: 'Stop', harness: 'claude', folder: '/w', message: 'There are\n42' });
    });

    it('takes the final message of the payload and the command of Codex', () => {
        expect(sessionEventOf('Stop', 'codex', { last_assistant_message: 'done' })).toMatchObject({ message: 'done' });
        expect(sessionEventOf('PostToolUse', 'codex', { tool_name: 'exec_command', tool_input: { cmd: 'ls -la' } })).toMatchObject({ status: 'ls -la' });
    });

    it('pairs the hooks before and after a tool by its id, a failed tool has an error', () => {
        const payload = { cwd: '/w', tool_use_id: 'toolu_1', tool_name: 'Read', tool_input: { file_path: '/w/a.sql' } };
        expect(sessionEventOf('PreToolUse', 'claude', payload)).toEqual({ event: 'PreToolUse', harness: 'claude', folder: '/w', status: 'Read a.sql', files: ['/w/a.sql'], toolUseId: 'toolu_1' });
        expect(sessionEventOf('PostToolUse', 'claude', payload)).toMatchObject({ event: 'PostToolUse', toolUseId: 'toolu_1' });
        expect(sessionEventOf('PostToolUseFailure', 'claude', { ...payload, error: 'File does not exist.' }))
            .toMatchObject({ event: 'PostToolUse', status: 'Read a.sql', toolUseId: 'toolu_1', error: 'File does not exist.' });
        expect(sessionEventOf('PreToolUse', 'codex', { tool_name: 'exec_command', tool_input: { cmd: 'ls' } })).toMatchObject({ status: 'ls', toolUseId: null });
    });

    it('shortens the paths of the folder and of the copies of workbooks', () => {
        const status = (tool_name: string, tool_input: unknown) => sessionEventOf('PreToolUse', 'claude', { cwd: '/home/u/p', tool_name, tool_input })?.status;
        expect(status('Edit', { file_path: '/home/u/p/.dashql/workbooks/wb1/scripts/a.sql' })).toBe('Edit scripts/a.sql');
        expect(status('Edit', { file_path: '/elsewhere/a.sql' })).toBe('Edit /elsewhere/a.sql');
        expect(status('Bash', { command: 'cd /home/u/p && dashql run .dashql/workbooks/wb1 --script /home/u/p/.dashql/workbooks/wb1/scripts/a.sql' }))
            .toBe('dashql run .dashql/workbooks/wb1 --script scripts/a.sql');
        expect(status('Bash', { command: 'cd "/home/u/p" && ls' })).toBe('ls');
        expect(status('Grep', { pattern: 'orders', path: '/home/u/p' })).toBe('Grep orders');
        expect(status('Glob', { pattern: '**/*.sql' })).toBe('Glob **/*.sql');
        expect(status('Agent', { description: 'Find the tables', prompt: 'long' })).toBe('Agent Find the tables');
        expect(status('TodoWrite', { todos: [] })).toBe('TodoWrite');
        const patch = '*** Begin Patch\n*** Update File: /home/u/p/scripts/a.sql\n@@\n-x\n+y\n*** Add File: b.sql\n+z\n*** End Patch';
        expect(sessionEventOf('PreToolUse', 'codex', { cwd: '/home/u/p', tool_name: 'apply_patch', tool_input: { command: patch } }))
            .toMatchObject({ status: 'apply_patch scripts/a.sql, b.sql', files: ['/home/u/p/scripts/a.sql', 'b.sql'] });
    });

    it('ignores events that a session does not follow', () => {
        expect(sessionEventOf('Notification', 'claude', {})).toBeNull();
        expect(sessionEventOf('SessionStart', 'claude', null)).toEqual({ event: 'SessionStart', harness: 'claude', folder: '' });
    });
});
