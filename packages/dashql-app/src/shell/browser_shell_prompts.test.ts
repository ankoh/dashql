import * as arrow from 'apache-arrow';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashQLShell } from './api.js';
import { embedDashQLShell, type BrowserShellController } from './browser_shell.js';
import { tableFromArrays } from '../tests/arrow_fixtures.js';

declare const DASHQL_SHELL_PRECOMPILED: Promise<Uint8Array>;

describe('browser shell prompt queue', () => {
    let container: HTMLDivElement;
    let shell: DashQLShell;
    let controller: BrowserShellController;
    let queries: string[];

    beforeEach(async () => {
        queries = [];
        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '400px';
        document.body.appendChild(container);
        shell = await DashQLShell.create({
            environment: {
                executeQuery: async query => {
                    queries.push(query);
                    return arrow.tableToIPC(tableFromArrays({}), 'file');
                },
            },
            terminalColumns: 80,
            wasmBinary: await DASHQL_SHELL_PRECOMPILED,
        });
        controller = await embedDashQLShell({ container, shell });
    });

    afterEach(() => {
        controller.dispose();
        shell.destroy();
        container.remove();
    });

    function promptText(): string {
        return shell.movePromptRight().text;
    }

    function press(key: string, init: KeyboardEventInit = {}) {
        const input = container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!;
        input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    }

    async function settle() {
        for (let i = 0; i < 20 && promptText().length === 0 && queries.length > 0; ++i) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    it('fills in each queued prompt after the previous one ran', async () => {
        controller.queuePrompts(['select 1;', 'select 2;']);
        expect(promptText()).toBe('select 1;');
        expect(queries).toEqual([]);

        press('Enter');
        await settle();
        expect(queries).toHaveLength(1);
        expect(promptText()).toBe('select 2;');

        press('Enter');
        await settle();
        expect(queries).toHaveLength(2);
        expect(promptText()).toBe('');
    });

    it('drops the remaining prompts on Ctrl+C', async () => {
        controller.queuePrompts(['select 1;', 'select 2;']);
        press('c', { ctrlKey: true });
        expect(promptText()).toBe('');

        shell.setPrompt('select 3;');
        press('Enter');
        await settle();
        expect(queries).toHaveLength(1);
        expect(promptText()).toBe('');
    });
});

describe('browser shell replacement', () => {
    let container: HTMLDivElement;
    let controller: BrowserShellController;
    const shells: DashQLShell[] = [];

    async function createShell(queries: string[], hang = false): Promise<DashQLShell> {
        const shell = await DashQLShell.create({
            environment: {
                executeQuery: async (query, signal) => {
                    queries.push(query);
                    if (hang) {
                        await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))));
                    }
                    return arrow.tableToIPC(tableFromArrays({}), 'file');
                },
            },
            terminalColumns: 80,
            wasmBinary: await DASHQL_SHELL_PRECOMPILED,
        });
        shells.push(shell);
        return shell;
    }

    beforeEach(() => {
        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '400px';
        document.body.appendChild(container);
    });

    afterEach(() => {
        controller.dispose();
        controller.dispose();
        for (const shell of shells) shell.destroy();
        shells.length = 0;
        container.remove();
    });

    function press(key: string, init: KeyboardEventInit = {}) {
        const input = container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!;
        input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    }

    it('moves the history to the new shell and runs the next prompt there', async () => {
        const oldQueries: string[] = [];
        const newQueries: string[] = [];
        const oldShell = await createShell(oldQueries);
        const newShell = await createShell(newQueries);
        controller = await embedDashQLShell({ container, shell: oldShell });
        oldShell.setPrompt('select 1;');
        press('Enter');
        await vi.waitFor(() => expect(oldQueries).toHaveLength(1));
        // Let the old shell finish its prompt
        await new Promise(resolve => setTimeout(resolve, 50));

        controller.replaceShell(newShell);
        press('ArrowUp');
        expect(newShell.movePromptRight().text).toBe('select 1;');
        press('Enter');
        await vi.waitFor(() => expect(newQueries).toHaveLength(1));
        expect(oldQueries).toHaveLength(1);
    });

    it('drops the queued prompts and cancels the running query of the old shell', async () => {
        const oldQueries: string[] = [];
        const newQueries: string[] = [];
        const oldShell = await createShell(oldQueries, true);
        const newShell = await createShell(newQueries);
        controller = await embedDashQLShell({ container, shell: oldShell });
        controller.queuePrompts(['select 1;', 'select 2;']);
        press('Enter');
        await vi.waitFor(() => expect(oldQueries).toEqual(['select 1']));

        controller.replaceShell(newShell);
        expect(newShell.movePromptRight().text).toBe('');
        // The aborted query of the old shell no longer blocks the prompt
        await vi.waitFor(() => {
            newShell.setPrompt('select 3;');
            press('Enter');
            expect(newQueries).toEqual(['select 3']);
        });
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(oldQueries).toEqual(['select 1']);
        expect(newShell.movePromptRight().text).toBe('');
    });

    it('writes a status line', async () => {
        const shell = await createShell([]);
        controller = await embedDashQLShell({ container, shell });
        controller.writeStatus('connected to hyper');
        await vi.waitFor(() => expect(container.textContent).toContain('connected to hyper'));
        controller.dispose();
        // A disposed shell ignores queued prompts
        controller.queuePrompts(['select 1;']);
        expect(shell.movePromptRight().text).toBe('');
    });
});
