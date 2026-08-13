// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { DashQLShellPromptInput } from './api.js';
import { sanitizeTerminalText, terminalPromptInputForKey } from './browser_shell.js';

describe('browser shell input', () => {
    it('rejects terminal key sequences from the text channel', () => {
        expect(sanitizeTerminalText('\t')).toBe('');
        expect(sanitizeTerminalText('\r')).toBe('');
        expect(sanitizeTerminalText('\x03')).toBe('');
        expect(sanitizeTerminalText('\x1b')).toBe('');
        expect(sanitizeTerminalText('\x1b[B')).toBe('');
        expect(sanitizeTerminalText('\x1b[3~')).toBe('');
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
});
