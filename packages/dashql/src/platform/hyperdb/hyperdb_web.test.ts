import { describe, expect, it } from 'vitest';

import { getHyperDBWebSupportError, isOutOfMemoryError, startWaitingForMemory, type HyperDBWebCapabilities } from './hyperdb_web.js';

function capabilities(overrides: Partial<HyperDBWebCapabilities> = {}): HyperDBWebCapabilities {
    return {
        crossOriginIsolated: true,
        hasSharedArrayBuffer: true,
        ...overrides,
    };
}

/// A start that fails with the given errors one after another, then returns the engine
function failingStart(errors: Error[]): { start: () => Promise<string>; attempts: () => number } {
    let attempts = 0;
    return {
        start: async () => {
            const error = errors[attempts++];
            if (error != null) throw error;
            return 'engine';
        },
        attempts: () => attempts,
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

describe('HyperDB memory wait', () => {
    it('recognizes the memory that WebKit refuses', () => {
        expect(isOutOfMemoryError(new Error('RangeError: Out of memory'))).toBe(true);
        expect(isOutOfMemoryError(new RangeError('Out of memory'))).toBe(true);
        expect(isOutOfMemoryError(new Error('engine aborted'))).toBe(false);
    });

    it('starts again after a wait until the memory fits', async () => {
        const { start, attempts } = failingStart([new Error('RangeError: Out of memory'), new Error('RangeError: Out of memory')]);
        const waits: number[] = [];
        expect(await startWaitingForMemory(start, (_, waitMs) => waits.push(waitMs), [1, 2, 3])).toBe('engine');
        expect(attempts()).toBe(3);
        expect(waits).toEqual([1, 2]);
    });

    it('gives up once the waits run out', async () => {
        const outOfMemory = new Error('RangeError: Out of memory');
        const { start, attempts } = failingStart([outOfMemory, outOfMemory, outOfMemory]);
        await expect(startWaitingForMemory(start, () => {}, [1, 2])).rejects.toBe(outOfMemory);
        expect(attempts()).toBe(3);
    });

    it('fails right away on other errors', async () => {
        const broken = new Error('engine aborted');
        const { start, attempts } = failingStart([broken]);
        await expect(startWaitingForMemory(start, () => {}, [1, 2])).rejects.toBe(broken);
        expect(attempts()).toBe(1);
    });
});
