// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { DashQLShellPromptInput } from './api.js';
import { loadWebglRenderer, sanitizeTerminalText, terminalPromptInputForKey } from './browser_shell.js';
import { VT100, VT100Command, vt100Sequence } from './vt100.js';

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
});
