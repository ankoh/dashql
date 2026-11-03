import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { forbidEval } from '../tests/forbid_eval.js';
import { binaryVector, boolVector, floatVector, intVector, utf8Vector } from './arrow_vectors.js';

describe('Arrow vectors from buffers', () => {
    it('assembles vectors without evaluating code, the Content-Security-Policy of the app forbids it', async () => {
        const vectors = await forbidEval(() => ({
            text: utf8Vector(['a', null, 'äö', '']),
            bytes: binaryVector([new Uint8Array([1]), null]),
            real: floatVector(new arrow.Float32(), [1.5, null]),
            double: floatVector(new arrow.Float64(), [0.25]),
            small: intVector(new arrow.Int16(), [-3, null]),
            big: intVector(new arrow.Uint64(), [2n ** 63n, null]),
            flag: boolVector([true, false, null]),
        }));

        expect([...vectors.text]).toEqual(['a', null, 'äö', '']);
        expect(vectors.text.nullCount).toBe(1);
        expect([...vectors.bytes]).toEqual([new Uint8Array([1]), null]);
        expect([...vectors.real]).toEqual([1.5, null]);
        expect([...vectors.double]).toEqual([0.25]);
        expect([...vectors.small]).toEqual([-3, null]);
        expect([...vectors.big]).toEqual([2n ** 63n, null]);
        expect([...vectors.flag]).toEqual([true, false, null]);
        expect(String(vectors.big.type)).toBe('Uint64');
    });

    it('leaves out the validity bitmap of a vector without nulls', () => {
        const vector = utf8Vector(['a', 'b']);

        expect(vector.nullCount).toBe(0);
        expect(vector.data[0].nullBitmap?.length ?? 0).toBe(0);
    });
});
