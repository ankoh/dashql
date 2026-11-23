// @vitest-environment node
import { createDialogCommand } from './dialog_command.js';

describe('a dialog command', () => {
    /// Run the command with the arguments and the context of a shell
    const runCommand = (requestDialog: () => Promise<void>, args: string[], signal?: AbortSignal) => {
        const [, , run] = createDialogCommand('format', 'Open the SQL formatter', requestDialog);
        return run(args, { signal });
    };

    it('has the name and the description of its dialog', () => {
        const [name, description] = createDialogCommand('plan', 'Open the query plan viewer', async () => { });
        expect(name).toBe('plan');
        expect(description).toBe('Open the query plan viewer');
    });

    it('rejects arguments before opening the dialog', async () => {
        const requestDialog = vi.fn();
        await expect(runCommand(requestDialog, ['unexpected'])).rejects.toThrow('usage: .format');
        expect(requestDialog).not.toHaveBeenCalled();
    });

    it('opens the dialog with the command abort signal and returns no output', async () => {
        const requestDialog = vi.fn().mockResolvedValue(undefined);
        const signal = new AbortController().signal;
        await expect(runCommand(requestDialog, [], signal)).resolves.toBeUndefined();
        expect(requestDialog).toHaveBeenCalledWith(signal);
    });

    it('does not open an already aborted request', async () => {
        const requestDialog = vi.fn();
        await expect(runCommand(requestDialog, [], AbortSignal.abort())).resolves.toBeUndefined();
        expect(requestDialog).not.toHaveBeenCalled();
    });
});
