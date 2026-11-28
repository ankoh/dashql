import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { vectorFromArray } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { arrowTableToRows } from './vegalite_rows.js';

/// A Decimal(28,6) column of the unscaled values, as Hyper returns sums of numerics
function decimalVector(unscaled: bigint[]): arrow.Vector {
    // Four little-endian words of the two's complement per value
    const words = new Uint32Array(unscaled.length * 4);
    unscaled.forEach((value, index) => {
        const bits = BigInt.asUintN(128, value);
        for (let word = 0; word < 4; ++word) words[index * 4 + word] = Number((bits >> BigInt(32 * word)) & 0xffffffffn);
    });
    return arrow.makeVector(arrow.makeData({ type: new arrow.Decimal(6, 28, 128), length: unscaled.length, data: words }));
}

describe('arrowTableToRows', () => {
    it('scales the values of decimal columns', () => {
        const table = new arrow.Table({
            region: vectorFromArray(['East', 'West']),
            revenue: decimalVector([600794200000n, -500000n]),
        });
        expect(arrowTableToRows(table)).toEqual([
            { region: 'East', revenue: 600794.2 },
            { region: 'West', revenue: -0.5 },
        ]);
    });
});
