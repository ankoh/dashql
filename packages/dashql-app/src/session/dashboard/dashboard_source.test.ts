import { describe, expect, it, vi } from 'vitest';

import { SET_SCRIPT_TEXT, type ScriptData } from '../scripts/session_scripts.js';
import { markdownTemplate, persistDashboardPlacement, setDashboardRenderer } from './dashboard_source.js';

describe('dashboard source persistence', () => {
    it('rewrites the card of the visualized statement in the core script session', () => {
        const rewriteVisBoard = vi.fn(() => 'rewritten sql');
        const modify = vi.fn();
        const script = {
            scriptKey: 7,
            scriptSession: { rewriteVisBoard },
            annotations: { visualizeQuery: { renderer: 'table', sql: 'select 1', statementId: 1 } },
        } as unknown as ScriptData;

        persistDashboardPlacement(script, { id: 7, section: 'visualizations', row: 2, column: 4, width: 5, height: 3 }, modify);

        expect(rewriteVisBoard).toHaveBeenCalledWith(1, 2, 4, 5, 3);
        expect(modify).toHaveBeenCalledWith({
            type: SET_SCRIPT_TEXT,
            value: { scriptKey: 7, text: 'rewritten sql', withDiff: false },
        });
    });

    it('places a collapsed card and keeps the height of its tag', () => {
        const rewriteVisBoard = vi.fn(() => 'rewritten sql');
        const modify = vi.fn();
        const script = {
            scriptKey: 7,
            scriptSession: { rewriteVisBoard },
            annotations: { visualizeQuery: null, boardPosition: { statementId: 2, row: 0, column: 0, width: 6, height: 4 } },
        } as unknown as ScriptData;

        persistDashboardPlacement(script, { id: 7, section: 'scripts', row: 2, column: 4, width: 5, height: 1 }, modify);

        expect(rewriteVisBoard).toHaveBeenCalledWith(2, 2, 4, 5, 4);
        expect(modify).toHaveBeenCalledWith({ type: SET_SCRIPT_TEXT, value: { scriptKey: 7, text: 'rewritten sql', withDiff: false } });
    });

    it('writes the renderer of a collapsed card', () => {
        const rewriteVisRenderer = vi.fn(() => '/* @vis table */\nselect 1');
        const modify = vi.fn();
        const script = {
            scriptKey: 7,
            scriptSession: { rewriteVisRenderer },
            annotations: { visualizeQuery: null, boardPosition: { statementId: 0, width: 6, height: 3 } },
        } as unknown as ScriptData;

        expect(setDashboardRenderer(script, 'table', '', modify)).toBe(true);
        expect(rewriteVisRenderer).toHaveBeenCalledWith(0, 'table', '');
        expect(modify).toHaveBeenCalledWith({ type: SET_SCRIPT_TEXT, value: { scriptKey: 7, text: '/* @vis table */\nselect 1', withDiff: true } });

        // A rewrite that fails leaves the script unchanged
        const failing = { ...script, scriptSession: { rewriteVisRenderer: () => { throw new Error('nope'); } } } as unknown as ScriptData;
        modify.mockReset();
        expect(setDashboardRenderer(failing, 'table', '', modify)).toBe(false);
        expect(modify).not.toHaveBeenCalled();
    });

    it('removes the renderer of a visualized card', () => {
        const rewriteVisRenderer = vi.fn(() => '/* @board width=6 height=3 */\nselect 1');
        const modify = vi.fn();
        const script = {
            scriptKey: 7,
            scriptSession: { rewriteVisRenderer },
            annotations: { visualizeQuery: { renderer: 'table', sql: 'select 1', statementId: 1 }, boardPosition: null },
        } as unknown as ScriptData;

        expect(setDashboardRenderer(script, null, '', modify)).toBe(true);
        expect(rewriteVisRenderer).toHaveBeenCalledWith(1, null, '');
        expect(modify).toHaveBeenCalledWith({ type: SET_SCRIPT_TEXT, value: { scriptKey: 7, text: '/* @board width=6 height=3 */\nselect 1', withDiff: true } });
    });

    it('starts a Markdown template with the columns', () => {
        expect(markdownTemplate([])).toBeNull();
        expect(markdownTemplate(['metric'])).toBe('### {{metric}}');
        expect(markdownTemplate(['metric', 'value', 'status'])).toBe('### {{metric}}\n{{value}} · {{status}}');
    });
});
