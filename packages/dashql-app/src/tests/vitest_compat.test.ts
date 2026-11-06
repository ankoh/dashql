import { describe, expect, it, vi } from 'vitest';

import { beginTestFile, endTestFile } from './vitest_compat.js';

const FILE = 'src/tests/vitest_compat.test.ts';
const STUB = '__DASHQL_TOP_LEVEL_STUB__';

function stubValue(): unknown {
    return (globalThis as Record<string, unknown>)[STUB];
}

vi.stubGlobal(STUB, 'top level');

describe('stubGlobal of the browser tests', () => {
    it('applies a stub of the top level of a file to its tests', () => {
        expect(stubValue()).toBe('top level');
    });

    it('removes the stubs at the end of a file and applies the top level stubs again to its next run', () => {
        vi.stubGlobal('__DASHQL_TEST_STUB__', 'test');
        endTestFile();
        expect(stubValue()).toBeUndefined();
        expect(STUB in globalThis).toBe(false);
        expect('__DASHQL_TEST_STUB__' in globalThis).toBe(false);

        beginTestFile(FILE);
        expect(stubValue()).toBe('top level');
    });
});
