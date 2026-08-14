import { describe, expect, it, vi } from 'vitest';

import { releaseAppliedPreviewSnapshot, releasePreviewSnapshot, type PreviewSnapshot } from './script_preview.js';

describe('releasePreviewSnapshot', () => {
    it('detaches CodeMirror extensions before releasing WASM buffers', () => {
        const calls: string[] = [];
        const dispatch = vi.fn((_transaction: unknown) => calls.push('dispatch'));
        const view = {
            dispatch,
        };
        const parsed = {
            destroy: vi.fn(() => calls.push('parsed')),
        };
        const diffBuffer = {
            destroy: vi.fn(() => calls.push('diff')),
        };

        releasePreviewSnapshot({
            scriptText: 'select 1;',
            parsed,
            ownsParsed: true,
            diff: { priorText: 'select 0;', diffBuffer },
        } as unknown as PreviewSnapshot, view);

        expect(calls).toEqual(['dispatch', 'parsed', 'diff']);
        expect(dispatch).toHaveBeenCalledOnce();
        expect((dispatch.mock.calls[0]![0] as { effects: unknown[] }).effects).toHaveLength(3);
    });

    it('does not detach a newer snapshot when an unapplied snapshot is released', () => {
        const dispatch = vi.fn();
        const oldParsed = { destroy: vi.fn() };
        const oldSnapshot = {
            scriptText: 'select 1;',
            parsed: oldParsed,
            ownsParsed: true,
            diff: null,
        } as unknown as PreviewSnapshot;
        const appliedSnapshot = {
            scriptText: 'select 2;',
            parsed: { destroy: vi.fn() },
            ownsParsed: true,
            diff: null,
        } as unknown as PreviewSnapshot;
        const applied = { view: { dispatch }, snapshot: appliedSnapshot } as Parameters<typeof releaseAppliedPreviewSnapshot>[1];

        expect(releaseAppliedPreviewSnapshot(oldSnapshot, applied)).toBe(applied);
        expect(dispatch).not.toHaveBeenCalled();
        expect(oldParsed.destroy).toHaveBeenCalledOnce();
    });
});
