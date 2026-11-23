import type { DashQLShellCommand } from '../../terminal/api.js';

/// A dot command without arguments that opens a dialog, it returns without output once the dialog closes
export function createDialogCommand(
    name: string,
    description: string,
    requestDialog: (signal?: AbortSignal) => Promise<void>,
): DashQLShellCommand {
    return [
        name,
        description,
        async (args, context) => {
            if (args.length !== 0) throw new Error(`usage: .${name}`);
            if (context.signal?.aborted) return;
            await requestDialog(context.signal);
        },
    ];
}
