// @vitest-environment node
import type { DashQLShellCommand } from '../../terminal/api.js';
import { createFormatCommand } from './format.js';
import { createPlanCommand } from './plan.js';
import { createShareCommand } from './share.js';

/// The commands that open a dialog and print nothing
const DIALOG_COMMANDS: [string, (dependencies: { requestDialog(signal?: AbortSignal): Promise<void> }) => DashQLShellCommand][] = [
    ['format', createFormatCommand],
    ['plan', createPlanCommand],
    ['share', createShareCommand],
];

for (const [name, createCommand] of DIALOG_COMMANDS) describe(`the dialog command .${name}`, () => {
    /// Run the command with the arguments and the context of a shell
    const runCommand = (requestDialog: () => Promise<void>, args: string[], signal?: AbortSignal) => {
        const [, , run] = createCommand({ requestDialog });
        return run(args, { signal });
    };

    it('rejects arguments before opening the dialog', async () => {
        const requestDialog = vi.fn();
        await expect(runCommand(requestDialog, ['unexpected'])).rejects.toThrow(`usage: .${name}`);
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
