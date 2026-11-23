import { describe, expect, it, vi } from 'vitest';

import type { ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { persistFlowPlacement, removeFlowPositions } from './dataflow_source.js';

function script(pendingDiff: unknown): ScriptData {
    return {
        scriptKey: 7,
        pendingDiff,
        scriptSession: { rewriteVisFlow: vi.fn(() => 'placed sql'), removeVisFlow: vi.fn(() => 'unplaced sql') },
        annotations: { flowPosition: { x: 10, y: 20, width: null, height: null } },
    } as unknown as ScriptData;
}

describe('dataflow source persistence', () => {
    it('writes a placement without staging it', () => {
        const modify = vi.fn();
        expect(persistFlowPlacement(script(null), { x: 30, y: 40 }, null, null, modify)).toBe(true);
        expect(modify).toHaveBeenCalledWith({ kind: 'setScriptText', value: { scriptKey: 7, text: 'placed sql', withDiff: false } });
    });

    it('keeps the diff that a script stages', () => {
        const modify = vi.fn();
        const staged = { priorText: 'select 1' };
        persistFlowPlacement(script(staged), { x: 30, y: 40 }, null, null, modify);
        expect(modify).toHaveBeenCalledWith({ kind: 'setScriptText', value: { scriptKey: 7, text: 'placed sql', withDiff: true } });

        modify.mockReset();
        removeFlowPositions([script(staged)], modify);
        expect(modify).toHaveBeenCalledWith({ kind: 'setScriptText', value: { scriptKey: 7, text: 'unplaced sql', withDiff: true } });
    });

    it('leaves an unchanged placement alone', () => {
        const modify = vi.fn();
        expect(persistFlowPlacement(script(null), { x: 10, y: 20 }, null, null, modify)).toBe(true);
        expect(modify).not.toHaveBeenCalled();
    });
});
