// @vitest-environment node
import { createExamplesCommand, type ExamplesCommandDependencies } from './shell_examples.js';

function dependencies(text: string | null, prompts: string[] = []): ExamplesCommandDependencies {
    return {
        requestSnippet: vi.fn().mockResolvedValue(text),
        splitPrompts: vi.fn().mockReturnValue(prompts),
        queuePrompts: vi.fn(),
    };
}

describe('shell examples command', () => {
    it('rejects arguments before opening the snippets', async () => {
        const deps = dependencies(null);

        await expect(createExamplesCommand(deps)[2](['q1'], {})).rejects.toThrow('usage: .examples');
        expect(deps.requestSnippet).not.toHaveBeenCalled();
    });

    it('opens the snippets with the command abort signal', async () => {
        const deps = dependencies(null);
        const signal = new AbortController().signal;

        await expect(createExamplesCommand(deps)[2]([], { signal })).resolves.toBeUndefined();
        expect(deps.requestSnippet).toHaveBeenCalledOnce();
        expect(deps.requestSnippet).toHaveBeenCalledWith(signal);
        expect(deps.queuePrompts).not.toHaveBeenCalled();
    });

    it('does not open an already aborted request', async () => {
        const deps = dependencies(null);
        const abort = new AbortController();
        abort.abort();

        await expect(createExamplesCommand(deps)[2]([], { signal: abort.signal })).resolves.toBeUndefined();
        expect(deps.requestSnippet).not.toHaveBeenCalled();
    });

    it('fills in a single statement without output', async () => {
        const deps = dependencies('select 1;\n', ['select 1;']);

        await expect(createExamplesCommand(deps)[2]([], {})).resolves.toBeUndefined();
        expect(deps.splitPrompts).toHaveBeenCalledWith('select 1;\n');
        expect(deps.queuePrompts).toHaveBeenCalledWith(['select 1;']);
    });

    it('queues the statements of a snippet one after another', async () => {
        const deps = dependencies('select 1;\nselect 2;\n', ['select 1;', 'select 2;']);

        await expect(createExamplesCommand(deps)[2]([], {})).resolves
            .toBe('Inserted 2 statements. Press Enter to run each, Ctrl+C to skip the rest.');
        expect(deps.queuePrompts).toHaveBeenCalledWith(['select 1;', 'select 2;']);
    });
});
