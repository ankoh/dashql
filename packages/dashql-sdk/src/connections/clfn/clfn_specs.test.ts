import { describe, expect, it } from 'vitest';

import { loadClientFunctionSpec } from './clfn_specs.js';

describe('client function specs', () => {
    it('loads the generated spec of an extension', async () => {
        const spec = await loadClientFunctionSpec('d360-api');
        expect(spec.namespace).toEqual('cdp');
        expect(spec.functions.length).toBeGreaterThan(500);
    });

    it('leaves out the prose of the reference', async () => {
        const spec = await loadClientFunctionSpec('d360-api');
        for (const fn of spec.functions) {
            expect(Object.keys(fn)).not.toContain('notes');
        }
    });

    it('fails for an extension that does not exist', async () => {
        await expect(loadClientFunctionSpec('nope')).rejects.toThrow('no extension in the folder nope');
    });
});
