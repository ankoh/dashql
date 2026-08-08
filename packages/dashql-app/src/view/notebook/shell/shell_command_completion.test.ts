import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { deriveShellCommandCompletion } from './shell_command_completion.js';

function completionFor(text: string, cursor = text.length) {
    const state = EditorState.create({
        doc: text,
        selection: EditorSelection.cursor(cursor),
    });
    return deriveShellCommandCompletion(state);
}

describe('Shell command completion', () => {
    it('offers dot commands by prefix', () => {
        const completion = completionFor('.c');
        expect(completion?.candidates.map(candidate => candidate.label)).toEqual([
            '.clear',
            '.catalog relations',
            '.catalog functions',
            '.catalog refresh',
            '.connection',
        ]);
        expect(completion?.from).toBe(0);
        expect(completion?.to).toBe(2);
    });

    it('completes catalog subcommands', () => {
        const completion = completionFor('.catalog f');
        expect(completion?.candidates).toEqual([{
            label: '.catalog functions',
            description: 'Open catalog functions',
        }]);
    });

    it('preserves leading whitespace in the replacement range', () => {
        const completion = completionFor('  .ex');
        expect(completion?.candidates.map(candidate => candidate.label)).toEqual(['.exit']);
        expect(completion?.from).toBe(2);
        expect(completion?.to).toBe(5);
    });

    it('does not offer completions for SQL, multiline input, or mid-document cursors', () => {
        expect(completionFor('select 1')).toBeNull();
        expect(completionFor('.catalog\nselect 1')).toBeNull();
        expect(completionFor('.catalog', 4)).toBeNull();
    });

    it('closes after an exact command is entered', () => {
        expect(completionFor('.clear')).toBeNull();
        expect(completionFor('.catalog')).not.toBeNull();
    });
});
