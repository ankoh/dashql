import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { tableFromArrays, vectorFromArray } from './arrow_fixtures.js';
import { forbidEval } from './forbid_eval.js';

describe('Arrow fixtures', () => {
    it('infers the types of vectorFromArray of Arrow without evaluating code', async () => {
        const table = await forbidEval(() => tableFromArrays({
            number: [1.5, null],
            text: ['a', null],
            big: [1n, null],
            flag: [true, null],
            time: [new Date(1000), null],
            list: [[1, 2], null],
            row: [{ x: 1, y: 'a' }, null],
            typed: Int32Array.from([1, 2]),
        }));

        expect(table.schema.fields.map(field => String(field.type))).toEqual([
            'Float64', 'Dictionary<Int32, Utf8>', 'Int64', 'Bool', 'Timestamp<MILLISECOND>', 'List<Float64>',
            'Struct<{x:Float64, y:Dictionary<Int32, Utf8>}>', 'Int32',
        ]);
        const expected = {
            number: [1.5, null], text: ['a', null], big: [1n, null], flag: [true, null], time: [1000, null], typed: [1, 2],
        };
        for (const name of Object.keys(expected) as Array<keyof typeof expected>) {
            expect([...table.getChild(name)!], name).toEqual(expected[name]);
        }
        expect(table.getChild('list')!.get(1)).toBeNull();
        expect(table.getChild('row')!.get(1)).toBeNull();
        expect([...table.getChild('list')!.get(0)!]).toEqual([1, 2]);
        expect(table.getChild('row')!.get(0)!.toJSON()).toEqual({ x: 1, y: 'a' });
    });

    it('builds the types that it is given, with nulls in the children', async () => {
        const vectors = await forbidEval(() => ({
            text: vectorFromArray(['a', null, ''], new arrow.Utf8()),
            small: vectorFromArray([1, null], new arrow.Int16()),
            words: vectorFromArray([['a', null], null], new arrow.List(new arrow.Field('item', new arrow.Utf8(), true))),
            label: vectorFromArray(['x', 'x', null], new arrow.Dictionary(new arrow.Utf8(), new arrow.Int8())),
        }));

        expect([...vectors.text]).toEqual(['a', null, '']);
        expect([...vectors.small]).toEqual([1, null]);
        expect([...vectors.words.get(0)!]).toEqual(['a', null]);
        expect(vectors.words.get(1)).toBeNull();
        expect([...vectors.label]).toEqual(['x', 'x', null]);
        expect(vectors.label.data[0].dictionary!.length).toBe(1);
    });

    it('keeps undefined a value like vectorFromArray of Arrow, only null is null', async () => {
        const vector = await forbidEval(() => vectorFromArray([undefined, null], new arrow.Float64()));

        expect(vector.nullCount).toBe(1);
    });
});
