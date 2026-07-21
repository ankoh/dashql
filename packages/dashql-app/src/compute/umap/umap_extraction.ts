import * as arrow from 'apache-arrow';

/// A row-major N×D matrix of embedding vectors extracted from an Arrow column.
export interface EmbeddingMatrix {
    /// Row-major values, length = count * dimension.
    data: Float32Array;
    /// Number of rows (points).
    count: number;
    /// Vector dimensionality.
    dimension: number;
}

/// Outcome of extracting an embedding column: either the matrix, or a typed
/// rejection describing why the column is not a usable vector column.
export type EmbeddingExtraction =
    | { ok: true; matrix: EmbeddingMatrix }
    | { ok: false; error: string };

/// Is `t` a 32-bit float Arrow type? UMAP consumes f32, and we deliberately do
/// NOT accept Float64/Float16 or integer element types: coercing them would mean
/// silently rewriting the user's data, and the invariant is that the vector
/// column is *already* correctly typed. Callers reject anything else.
function isFloat32(t: arrow.DataType): boolean {
    return arrow.DataType.isFloat(t) && (t as arrow.Float).precision === arrow.Precision.SINGLE;
}

/// Extract a `FixedSizeList<Float32>` / `List<Float32>` Arrow column into a
/// row-major N×D `Float32Array`.
///
/// STRICT TYPING (deliberate — mirrors how the vegalite path never rewrites the
/// user's SQL to fit the renderer): the column must already be a list of 32-bit
/// floats. We do NOT cast Float64→Float32, unwrap structs, or coerce integers;
/// a column of the wrong type is rejected with a clear message so the user fixes
/// the *query*, not us silently massaging the data. See the plan's workstream E
/// and the `project_embeddingatlas_renderer_vendor` memory.
///
/// Zero-copy where possible: for a single-chunk `FixedSizeList<Float32>` the child
/// values buffer is already the contiguous row-major matrix, returned as a
/// subarray view (no copy). Multi-chunk or `List<Float32>` columns are copied once
/// into a single preallocated array (still buffer-level `.set()`, never per-element
/// `.get(i)`). Null rows (or, for `List`, rows whose length ≠ the inferred
/// dimension) are written as zero vectors so the output keeps a uniform stride
/// (UMAP requires a rectangular input).
///
/// Arrow-21 buffer indexing (verified against `Vector.get`, incl. sliced +
/// multi-chunk concat columns): a chunk's `Data.values` is ALREADY narrowed to that
/// chunk's logical window, so a `FixedSizeList` row `i` is `values[i*dim .. (i+1)*dim]`
/// indexed FROM ZERO — `chunk.offset`/`child.offset` must NOT be added (adding them
/// reads past the narrowed buffer and silently corrupts coordinates on any sliced
/// column). For `List`, `values` is NOT narrowed but the (chunk-relative) `valueOffsets`
/// are absolute indices into it, so row `i` is `values[offsets[i] .. offsets[i+1]]`.
export function extractEmbeddingMatrix(table: arrow.Table, columnName: string): EmbeddingExtraction {
    const column = table.getChild(columnName) as arrow.Vector | null;
    if (!column) {
        return { ok: false, error: `Column "${columnName}" not found in the query result` };
    }

    const type = column.type as arrow.DataType;
    const count = column.length;
    if (count === 0) {
        return { ok: false, error: `Vector column "${columnName}" is empty` };
    }

    if (arrow.DataType.isFixedSizeList(type)) {
        return extractFixedSizeList(column, columnName, count, type as arrow.FixedSizeList);
    }
    if (arrow.DataType.isList(type)) {
        return extractVariableList(column, columnName, count, type as arrow.List);
    }

    return {
        ok: false,
        error:
            `Vector column "${columnName}" must be FixedSizeList<Float32> or List<Float32>, ` +
            `but is ${type}. Cast it to FLOAT[] in the query.`,
    };
}

/// FixedSizeList<Float32>: dimension is fixed by the type; the child values buffer
/// is the row-major matrix. Single chunk → zero-copy subarray; multi-chunk → one
/// preallocated array filled by per-chunk buffer copies.
function extractFixedSizeList(
    column: arrow.Vector,
    columnName: string,
    count: number,
    type: arrow.FixedSizeList,
): EmbeddingExtraction {
    if (!isFloat32(type.children[0].type)) {
        return {
            ok: false,
            error:
                `Vector column "${columnName}" is FixedSizeList<${type.children[0].type}>, ` +
                `but must be FixedSizeList<Float32>. Cast it to FLOAT[] in the query.`,
        };
    }
    const dimension = type.listSize;
    if (dimension === 0) {
        return { ok: false, error: `Vector column "${columnName}" has a zero-length list size` };
    }

    const chunks = column.data;

    // Fast path: a single chunk with no nulls. Its `values` buffer is already
    // narrowed to the chunk window, so it IS the contiguous row-major matrix —
    // return a view over it with no copy. (`chunk.length * dimension` bounds the
    // subarray in case the chunk over-allocated its backing buffer.)
    if (chunks.length === 1 && column.nullCount === 0) {
        const values = chunks[0].children[0].values as Float32Array;
        return {
            ok: true,
            matrix: { data: values.subarray(0, count * dimension), count, dimension },
        };
    }

    // General path: copy each chunk's values slab into one preallocated array,
    // zeroing null rows so the stride stays uniform. Index from 0 within each
    // chunk (values is already chunk-relative — see the header note).
    const data = new Float32Array(count * dimension);
    let row = 0;
    for (const chunk of chunks) {
        const values = chunk.children[0].values as Float32Array;
        if (chunk.nullCount === 0) {
            data.set(values.subarray(0, chunk.length * dimension), row * dimension);
        } else {
            for (let i = 0; i < chunk.length; ++i) {
                if (chunk.getValid(i)) {
                    const src = i * dimension;
                    data.set(values.subarray(src, src + dimension), (row + i) * dimension);
                }
            }
        }
        row += chunk.length;
    }
    return { ok: true, matrix: { data, count, dimension } };
}

/// List<Float32>: variable-length per row. The dimension is inferred from the
/// first non-null row; rows whose length differs (including nulls) become zero
/// vectors. Values are copied per row via the child values buffer + valueOffsets
/// (no per-element `.get`).
function extractVariableList(
    column: arrow.Vector,
    columnName: string,
    count: number,
    type: arrow.List,
): EmbeddingExtraction {
    if (!isFloat32(type.children[0].type)) {
        return {
            ok: false,
            error:
                `Vector column "${columnName}" is List<${type.children[0].type}>, ` +
                `but must be List<Float32>. Cast it to FLOAT[] in the query.`,
        };
    }

    // Infer the dimension from the first non-null row's list length.
    let dimension = 0;
    outer: for (const chunk of column.data) {
        const offsets = chunk.valueOffsets as Int32Array;
        for (let i = 0; i < chunk.length; ++i) {
            if (chunk.getValid(i)) {
                dimension = offsets[i + 1] - offsets[i];
                break outer;
            }
        }
    }
    if (dimension === 0) {
        return { ok: false, error: `Vector column "${columnName}" has no non-empty rows` };
    }

    const data = new Float32Array(count * dimension);
    let row = 0;
    for (const chunk of column.data) {
        const values = chunk.children[0].values as Float32Array;
        const offsets = chunk.valueOffsets as Int32Array;
        for (let i = 0; i < chunk.length; ++i) {
            if (!chunk.getValid(i)) continue;
            const begin = offsets[i];
            const end = offsets[i + 1];
            if (end - begin !== dimension) continue; // ragged row → leave as a zero vector
            // valueOffsets are absolute indices into the (non-narrowed) child values.
            data.set(values.subarray(begin, end), (row + i) * dimension);
        }
        row += chunk.length;
    }
    return { ok: true, matrix: { data, count, dimension } };
}

/// Read a single-precision float Arrow column into a contiguous `Float32Array`,
/// one entry per row. Used by the scatter renderer to pull the computed UMAP `x`/`y`
/// coordinate columns back out of the post-processed data table.
///
/// Single-chunk, no-null columns return a zero-copy subarray view over the live
/// child buffer (already chunk-narrowed — see the buffer-indexing note above; do
/// NOT add `chunk.offset`). Multi-chunk or nullable columns are copied once via
/// buffer-level `.set()`; null rows are left as 0.
export function extractFloat32Column(table: arrow.Table, columnName: string): Float32Array | null {
    const column = table.getChild(columnName) as arrow.Vector | null;
    if (!column) return null;
    if (!isFloat32(column.type as arrow.DataType)) return null;

    const count = column.length;
    const chunks = column.data;

    if (chunks.length === 1 && column.nullCount === 0) {
        const values = chunks[0].values as Float32Array;
        return values.subarray(0, count);
    }

    const out = new Float32Array(count);
    let row = 0;
    for (const chunk of chunks) {
        const values = chunk.values as Float32Array;
        if (chunk.nullCount === 0) {
            out.set(values.subarray(0, chunk.length), row);
        } else {
            for (let i = 0; i < chunk.length; ++i) {
                if (chunk.getValid(i)) out[row + i] = values[i];
            }
        }
        row += chunk.length;
    }
    return out;
}
