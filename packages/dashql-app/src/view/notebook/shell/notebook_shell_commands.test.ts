import { describe, expect, it, vi } from 'vitest';

import {
    executeShellCommand,
    listShellCommandCompletions,
    listShellCommands,
    parseShellCommand,
    resolveShellCommand,
} from './notebook_shell_commands.js';

describe('Notebook Shell commands', () => {
    const context = () => ({
        clearEntries: vi.fn(),
        openCatalog: vi.fn(),
        refreshCatalog: vi.fn(() => null),
        openConnection: vi.fn(),
        showNotebook: vi.fn(),
    });

    it('parses commands case-insensitively with arguments', () => {
        expect(parseShellCommand('  .CLEAR now  ')).toEqual({ name: 'clear', args: ['now'] });
        expect(parseShellCommand('select 1;')).toBeNull();
    });

    it('registers and executes .clear', () => {
        const commandContext = context();
        expect(resolveShellCommand('CLEAR')?.description).toContain('output');
        expect(executeShellCommand('.clear', commandContext)).toBeNull();
        expect(commandContext.clearEntries).toHaveBeenCalledOnce();
    });

    it('dispatches catalog subcommands', () => {
        const commandContext = context();
        expect(executeShellCommand('.catalog relations', commandContext)).toBeNull();
        expect(commandContext.openCatalog).toHaveBeenCalledWith('relations');
        expect(executeShellCommand('.catalog functions', commandContext)).toBeNull();
        expect(commandContext.openCatalog).toHaveBeenCalledWith('functions');
        expect(executeShellCommand('.catalog refresh', commandContext)).toBeNull();
        expect(commandContext.refreshCatalog).toHaveBeenCalledOnce();
        expect(executeShellCommand('.catalog', commandContext)).toContain('Usage:');
    });

    it('opens settings and exits to Notebook mode', () => {
        const commandContext = context();
        executeShellCommand('.connection', commandContext);
        executeShellCommand('.exit', commandContext);
        expect(commandContext.openConnection).toHaveBeenCalledOnce();
        expect(commandContext.showNotebook).toHaveBeenCalledOnce();
        expect(executeShellCommand('.notebook', commandContext)).toBe('Unknown Shell command: .notebook');
    });

    it('returns an actionable error for unknown commands', () => {
        expect(executeShellCommand('.missing', context()))
            .toBe('Unknown Shell command: .missing');
    });

    it('exposes commands for future help and completion UI', () => {
        expect(listShellCommands().map(command => command.name))
            .toEqual(expect.arrayContaining(['clear', 'catalog', 'connection', 'exit']));
        expect(listShellCommandCompletions().map(command => command.label)).toEqual([
            '.clear',
            '.catalog relations',
            '.catalog functions',
            '.catalog refresh',
            '.connection',
            '.exit',
        ]);
    });
});
