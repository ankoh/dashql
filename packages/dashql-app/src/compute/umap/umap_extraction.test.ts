import { describe, it, expect } from 'vitest';
import * as arrow from 'apache-arrow';

import { extractEmbeddingMatrix, extractFloat32Column } from './umap_extraction.js';

/// Build a single-column Arrow table around a prepared vector.
function tableOf(name: string, vec: arrow.Vector): arrow.Table {
    return new arrow.Table({ [name]: vec });
}

/// FixedSizeList<Float32>[dim] vector from flat row-major data.
function fixedSizeListVec(flat: number[], dim: number, nullBitmap?: Uint8Array): arrow.Vector {
    const child = arrow.makeData({ type: new arrow.Float32(), data: Float32Array.from(flat) });
    const type = new arrow.FixedSizeList(dim, new arrow.Field('item', new arrow.Float32()));
    const rows = flat.length / dim;
    const nullCount = nullBitmap ? rows - popcount(nullBitmap, rows) : 0;
    return arrow.makeVector(
        arrow.makeData({ type, length: rows, nullCount, nullBitmap, child }),
    );
}

/// List<Float32> vector from flat data + offsets.
function listVec(flat: number[], offsets: number[]): arrow.Vector {
    const child = arrow.makeData({ type: new arrow.Float32(), data: Float32Array.from(flat) });
    const type = new arrow.List(new arrow.Field('item', new arrow.Float32()));
    return arrow.makeVector(
        arrow.makeData({ type, length: offsets.length - 1, nullCount: 0, valueOffsets: Int32Array.from(offsets), child }),
    );
}

function popcount(bitmap: Uint8Array, bits: number): number {
    let n = 0;
    for (let i = 0; i < bits; ++i) if ((bitmap[i >> 3] & (1 << (i & 7))) !== 0) n++;
    return n;
}

describe('extractEmbeddingMatrix', () => {
    it('extracts a single-chunk FixedSizeList<Float32> zero-copy', () => {
        const table = tableOf('v', fixedSizeListVec([1, 2, 3, 4, 5, 6], 3));
        const res = extractEmbeddingMatrix(table, 'v');
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.matrix.count).toBe(2);
        expect(res.matrix.dimension).toBe(3);
        expect(Array.from(res.matrix.data)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    // The offset trap: after slicing, a chunk's values buffer is already narrowed
    // to the chunk window. Indexing with chunk.offset/child.offset would corrupt
    // these coordinates (see project_arrow_child_buffer_offset_trap memory).
    it('handles a sliced FixedSizeList column without offset corruption', () => {
        const full = fixedSizeListVec([1, 2, 3, 4, 5, 6, 7, 8, 9], 3);
        const sliced = full.slice(1, 3); // rows 1..2 → [4,5,6, 7,8,9]
        const res = extractEmbeddingMatrix(tableOf('v', sliced), 'v');
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.matrix.count).toBe(2);
        expect(Array.from(res.matrix.data)).toEqual([4, 5, 6, 7, 8, 9]);
    });

    it('handles a multi-chunk (concat) FixedSizeList column', () => {
        const a = tableOf('v', fixedSizeListVec([1, 2, 3, 4, 5, 6], 3));
        const b = tableOf('v', fixedSizeListVec([7, 8, 9], 3));
        const concat = a.concat(b);
        expect(concat.getChild('v')!.data.length).toBe(2); // genuinely two chunks
        const res = extractEmbeddingMatrix(concat, 'v');
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.matrix.count).toBe(3);
        expect(Array.from(res.matrix.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('zeroes null rows in a FixedSizeList to keep a uniform stride', () => {
        // 3 rows, row index 1 is null: bits for rows 0,2 set → 0b101 = 0x05.
        const vec = fixedSizeListVec([1, 2, 3, 9, 9, 9, 7, 8, 9], 3, new Uint8Array([0b101]));
        const res = extractEmbeddingMatrix(tableOf('v', vec), 'v');
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(Array.from(res.matrix.data)).toEqual([1, 2, 3, 0, 0, 0, 7, 8, 9]);
    });

    it('extracts a List<Float32> via value offsets', () => {
        const res = extractEmbeddingMatrix(tableOf('v', listVec([1, 2, 3, 4, 5, 6], [0, 3, 6])), 'v');
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.matrix.dimension).toBe(3);
        expect(Array.from(res.matrix.data)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('leaves ragged List rows as zero vectors', () => {
        // Second row has length 2 (≠ inferred dim 3) → zeroed.
        const res = extractEmbeddingMatrix(tableOf('v', listVec([1, 2, 3, 4, 5, 6, 7], [0, 3, 5, 7])), 'v');
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.matrix.count).toBe(3);
        expect(Array.from(res.matrix.data.subarray(3, 6))).toEqual([0, 0, 0]);
    });

    it('rejects a non-list column with a typed error (no coercion)', () => {
        const vec = arrow.makeVector(arrow.makeData({ type: new arrow.Float32(), data: Float32Array.from([1, 2, 3]) }));
        const res = extractEmbeddingMatrix(tableOf('v', vec), 'v');
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error).toMatch(/must be FixedSizeList<Float32> or List<Float32>/);
    });

    it('rejects a Float64 element type rather than downcasting', () => {
        const child = arrow.makeData({ type: new arrow.Float64(), data: Float64Array.from([1, 2, 3, 4]) });
        const type = new arrow.FixedSizeList(2, new arrow.Field('item', new arrow.Float64()));
        const vec = arrow.makeVector(arrow.makeData({ type, length: 2, nullCount: 0, child }));
        const res = extractEmbeddingMatrix(tableOf('v', vec), 'v');
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error).toMatch(/must be FixedSizeList<Float32>/);
    });

    it('rejects a missing column', () => {
        const res = extractEmbeddingMatrix(tableOf('v', fixedSizeListVec([1, 2], 2)), 'nope');
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error).toMatch(/not found/);
    });
});

/// Build a single-column Float32 Arrow table.
function float32TableOf(name: string, data: number[]): arrow.Table {
    const vec = arrow.makeVector(arrow.makeData({ type: new arrow.Float32(), data: Float32Array.from(data) }));
    return new arrow.Table({ [name]: vec });
}

describe('extractFloat32Column', () => {
    it('reads a single-chunk Float32 column zero-copy', () => {
        const out = extractFloat32Column(float32TableOf('x', [1, 2, 3]), 'x');
        expect(out).not.toBeNull();
        expect(Array.from(out!)).toEqual([1, 2, 3]);
    });

    it('reads a multi-chunk (concat) Float32 column', () => {
        const concat = float32TableOf('x', [1, 2]).concat(float32TableOf('x', [3, 4]));
        expect(concat.getChild('x')!.data.length).toBe(2);
        const out = extractFloat32Column(concat, 'x');
        expect(out).not.toBeNull();
        expect(Array.from(out!)).toEqual([1, 2, 3, 4]);
    });

    it('returns null for a missing column', () => {
        expect(extractFloat32Column(float32TableOf('x', [1]), 'nope')).toBeNull();
    });

    it('returns null for a non-Float32 column', () => {
        const vec = arrow.makeVector(arrow.makeData({ type: new arrow.Float64(), data: Float64Array.from([1, 2]) }));
        expect(extractFloat32Column(new arrow.Table({ y: vec }), 'y')).toBeNull();
    });
});
