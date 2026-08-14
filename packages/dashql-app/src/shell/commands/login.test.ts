// @vitest-environment node
import { DashQLShell } from '../api.js';
import { LOGIN_UNAVAILABLE_MESSAGE, loginCommand } from './login.js';

declare const DASHQL_SHELL_PRECOMPILED: Promise<Uint8Array>;

describe('standalone shell login command', () => {
    it('is discoverable and does not execute SQL', async () => {
        const executeQuery = vi.fn();
        const shell = await DashQLShell.create({
            environment: { executeQuery },
            commands: [loginCommand],
            wasmBinary: await DASHQL_SHELL_PRECOMPILED,
        });
        try {
            shell.setPrompt('.help');
            expect(await shell.submitPrompt()).toContain('.login');
            shell.setPrompt('.login');
            expect(await shell.submitPrompt()).toBe(LOGIN_UNAVAILABLE_MESSAGE);
            expect(executeQuery).not.toHaveBeenCalled();
        } finally {
            shell.destroy();
        }
    });
});
