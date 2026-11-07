import { describe, expect, it } from 'vitest';

import { loadOverlaySpec } from './overlay_specs.js';

describe('overlay specs', () => {
    it('loads the generated spec of an overlay', async () => {
        const spec = await loadOverlaySpec('d360');
        expect(spec.namespace).toEqual('cdp');
        expect(spec.functions.length).toBeGreaterThan(500);
    });

    it('leaves out the prose of the reference', async () => {
        const spec = await loadOverlaySpec('d360');
        for (const fn of spec.functions) {
            expect(Object.keys(fn)).not.toContain('notes');
            expect(Object.keys(fn)).not.toContain('example');
        }
        expect(JSON.stringify(spec).length).toBeLessThan(1_000_000);
    });

    it('fails for an overlay that does not exist', async () => {
        await expect(loadOverlaySpec('nope')).rejects.toThrow('no overlay in the folder nope');
    });
});
