import { describe, expect, it } from 'vitest';

import { getHyperDBWebSupportError, type HyperDBWebCapabilities } from './hyperdb_web_support.js';

function capabilities(overrides: Partial<HyperDBWebCapabilities> = {}): HyperDBWebCapabilities {
    return {
        crossOriginIsolated: true,
        hasSharedArrayBuffer: true,
        ...overrides,
    };
}

describe('HyperDB web support', () => {
    it('explains missing isolation', () => {
        expect(getHyperDBWebSupportError(capabilities({ crossOriginIsolated: false }))).toContain('cross-origin-isolated');
    });

    it('accepts isolated browsers with SharedArrayBuffer', () => {
        expect(getHyperDBWebSupportError(capabilities())).toBeNull();
    });
});
