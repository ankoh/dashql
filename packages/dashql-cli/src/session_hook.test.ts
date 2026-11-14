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

    it('ignores events that a session does not follow', () => {
        expect(sessionEventOf('PreToolUse', 'claude', {})).toBeNull();
        expect(sessionEventOf('SessionStart', 'claude', null)).toEqual({ event: 'SessionStart', harness: 'claude', folder: '' });
    });
});
