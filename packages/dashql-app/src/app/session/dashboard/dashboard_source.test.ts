import { describe, expect, it, vi } from 'vitest';

import { SET_SCRIPT_TEXT, type ScriptData } from '../scripts/session_scripts.js';
import { persistDashboardPlacement } from './dashboard_source.js';

describe('dashboard source persistence', () => {
    it('rewrites the card of the visualized statement in the core script session', () => {
        const rewriteVisCard = vi.fn(() => 'rewritten sql');
        const modify = vi.fn();
        const script = {
            scriptKey: 7,
            scriptSession: { rewriteVisCard },
            annotations: { visualizeQuery: { renderer: 'table', sql: 'select 1', statementId: 1 } },
        } as unknown as ScriptData;

        persistDashboardPlacement(script, { id: 7, row: 2, column: 4, width: 5, height: 3 }, modify);

        expect(rewriteVisCard).toHaveBeenCalledWith(1, 2, 4, 5, 3);
        expect(modify).toHaveBeenCalledWith({
            type: SET_SCRIPT_TEXT,
            value: { scriptKey: 7, text: 'rewritten sql' },
        });
    });

    it('leaves scripts without a visualization unchanged', () => {
        const rewriteVisCard = vi.fn();
        const modify = vi.fn();
        const script = {
            scriptKey: 7,
            scriptSession: { rewriteVisCard },
            annotations: { visualizeQuery: null },
        } as unknown as ScriptData;

        persistDashboardPlacement(script, { id: 7, row: 2, column: 4, width: 5, height: 3 }, modify);

        expect(rewriteVisCard).not.toHaveBeenCalled();
        expect(modify).not.toHaveBeenCalled();
    });
});
