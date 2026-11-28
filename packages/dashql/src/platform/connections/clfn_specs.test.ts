import { describe, expect, it } from 'vitest';

import { loadClientFunctionSpec } from './clfn_specs.js';

describe('client function specs', () => {
    it('loads the generated spec of an extension', async () => {
        const spec = await loadClientFunctionSpec('d360-api');
        expect(spec.namespace).toEqual('d360');
        expect(spec.functions.map(fn => fn.name)).toContain('connection_list');
    });

    it('fails for an extension that does not exist', async () => {
        await expect(loadClientFunctionSpec('nope')).rejects.toThrow('no extension in the folder nope');
    });
});
