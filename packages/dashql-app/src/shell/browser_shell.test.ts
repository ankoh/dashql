// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashQLShellPromptInput } from './api.js';
import {
    formatQueryCompletion,
    formatTerminalGreeter,
    loadWebglRenderer,
    sanitizeTerminalText,
    TerminalQueryProgress,
    terminalPromptInputForKey,
} from './browser_shell.js';
import { VT100, VT100Command, vt100Sequence } from './vt100.js';

afterEach(() => vi.useRealTimers());

describe('browser shell input', () => {
    it('rejects terminal key sequences from the text channel', () => {
        expect(sanitizeTerminalText('\t')).toBe('');
        expect(sanitizeTerminalText('\r')).toBe('');
        expect(sanitizeTerminalText('\x03')).toBe('');
        expect(sanitizeTerminalText(VT100.ESCAPE)).toBe('');
        expect(sanitizeTerminalText(vt100Sequence(1, VT100Command.CURSOR_DOWN))).toBe('');
        expect(sanitizeTerminalText(`${VT100.CSI}3~`)).toBe('');
    });

    it('preserves pasted and composed text', () => {
        expect(sanitizeTerminalText('SELECT 界')).toBe('SELECT 界');
        expect(sanitizeTerminalText('SELECT 1;\r\nSELECT 2;')).toBe('SELECT 1;\nSELECT 2;');
        expect(sanitizeTerminalText('SELECT\tvalue')).toBe('SELECT\tvalue');
    });

    it('maps vertical arrows to prompt navigation', () => {
        expect(terminalPromptInputForKey('ArrowUp')).toBe(DashQLShellPromptInput.UP);
        expect(terminalPromptInputForKey('ArrowDown')).toBe(DashQLShellPromptInput.DOWN);
    });

    it('maps Tab to completion', () => {
        expect(terminalPromptInputForKey('Tab')).toBe(DashQLShellPromptInput.TAB);
    });

    it('maps Home and End to prompt boundaries', () => {
        expect(terminalPromptInputForKey('Home')).toBe(DashQLShellPromptInput.START);
        expect(terminalPromptInputForKey('End')).toBe(DashQLShellPromptInput.END);
    });

    it('maps shell convenience shortcuts to prompt boundaries', () => {
        expect(terminalPromptInputForKey('a', true)).toBe(DashQLShellPromptInput.START);
        expect(terminalPromptInputForKey('A', true)).toBe(DashQLShellPromptInput.START);
        expect(terminalPromptInputForKey('e', true)).toBe(DashQLShellPromptInput.END);
        expect(terminalPromptInputForKey('a')).toBeNull();
    });
});

describe('browser shell renderer', () => {
    it('formats a custom greeter with a blank line before the prompt', () => {
        expect(formatTerminalGreeter(['Hyper Web Shell', 'Enter .help for usage hints.'])).toBe(
            VT100.ENABLE_AUTO_WRAP + VT100.BOLD + 'Hyper Web Shell' + VT100.RESET_ATTRIBUTES + VT100.NEW_LINE +
            'Enter .help for usage hints.' + VT100.NEW_LINE + VT100.NEW_LINE,
        );
        expect(formatTerminalGreeter(['DashQL Shell', 'Enter .help for usage hints.'])).toBe(
            VT100.ENABLE_AUTO_WRAP + VT100.BOLD + 'DashQL Shell' + VT100.RESET_ATTRIBUTES + VT100.NEW_LINE +
            'Enter .help for usage hints.' + VT100.NEW_LINE + VT100.NEW_LINE,
        );
    });

    it('formats compact query completion summaries', () => {
        expect(formatQueryCompletion(0)).toBe(`Query completed (0 rows)${VT100.NEW_LINE}`);
        expect(formatQueryCompletion(1)).toBe(`Query completed (1 row)${VT100.NEW_LINE}`);
        expect(formatQueryCompletion(42)).toBe(`Query completed (42 rows)${VT100.NEW_LINE}`);
    });

    it('loads the WebGL addon when the terminal accepts it', async () => {
        let loaded = false;
        const terminal = {
            loadAddon: () => {
                loaded = true;
            },
        };

        expect(await loadWebglRenderer(terminal as never)).toBe(true);
        expect(loaded).toBe(true);
    });

    it('keeps the DOM renderer when WebGL initialization fails', async () => {
        const terminal = {
            loadAddon: () => {
                throw new Error('WebGL unavailable');
            },
        };

        expect(await loadWebglRenderer(terminal as never)).toBe(false);
    });

    it('replaces one progress line while cycling through the requested spinner frames', () => {
        vi.useFakeTimers();
        const write = vi.fn();
        const shell = {
            renderTerminalQueryProgress: vi.fn((message: string, advanceFrame: boolean) => ({
                data: advanceFrame ? 'next frame' : `progress: ${message}`,
            })),
            clearTerminalQueryProgress: vi.fn(() => ({ data: 'clear progress' })),
        };
        const progress = new TerminalQueryProgress(shell as never, write);

        progress.update('Executing query');
        expect(shell.renderTerminalQueryProgress).toHaveBeenLastCalledWith('Executing query');
        expect(write).toHaveBeenLastCalledWith('progress: Executing query');

        vi.advanceTimersByTime(80);
        expect(shell.renderTerminalQueryProgress).toHaveBeenLastCalledWith('', true);
        expect(write).toHaveBeenLastCalledWith('next frame');

        progress.update('Received result batch');
        expect(shell.renderTerminalQueryProgress).toHaveBeenLastCalledWith('Received result batch');
        expect(write).toHaveBeenLastCalledWith('progress: Received result batch');
        progress.clear();
        expect(shell.clearTerminalQueryProgress).toHaveBeenCalledOnce();
        expect(write).toHaveBeenLastCalledWith('clear progress');
        const callsAfterClear = write.mock.calls.length;
        vi.advanceTimersByTime(160);
        expect(write).toHaveBeenCalledTimes(callsAfterClear);
    });

    it('can stop animation without clearing C++ terminal progress state', () => {
        vi.useFakeTimers();
        const write = vi.fn();
        const shell = {
            renderTerminalQueryProgress: vi.fn((message: string) => ({ data: `progress: ${message}` })),
            clearTerminalQueryProgress: vi.fn(() => ({ data: 'clear progress' })),
        };
        const progress = new TerminalQueryProgress(shell as never, write);

        progress.update('Executing query');
        progress.stop();
        vi.advanceTimersByTime(160);

        expect(shell.clearTerminalQueryProgress).not.toHaveBeenCalled();
        expect(write).toHaveBeenCalledOnce();
    });

    it('uses a static spinner when reduced motion is requested', () => {
        vi.useFakeTimers();
        const write = vi.fn();
        const shell = {
            renderTerminalQueryProgress: vi.fn((message: string) => ({ data: `progress: ${message}` })),
            clearTerminalQueryProgress: vi.fn(() => ({ data: 'clear progress' })),
        };
        const progress = new TerminalQueryProgress(shell as never, write, true);

        progress.update('Executing query');
        vi.advanceTimersByTime(800);

        expect(write).toHaveBeenCalledOnce();
        expect(shell.renderTerminalQueryProgress).toHaveBeenCalledOnce();
        progress.clear();
    });
});
