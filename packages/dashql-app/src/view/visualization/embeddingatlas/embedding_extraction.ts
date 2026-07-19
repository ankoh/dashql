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

/// Extract a `List<Float>` / `FixedSizeList<Float>` Arrow column into a row-major
/// N×D `Float32Array`. Rows whose list is null or whose length differs from the
/// inferred dimension are written as zero vectors, so the output always has a
/// uniform stride (UMAP requires a rectangular input).
///
/// The dimension is inferred from the FixedSizeList type when available, otherwise
/// from the first non-null row.
export function extractEmbeddingMatrix(table: arrow.Table, columnName: string): EmbeddingMatrix | null {
    const column = table.getChild(columnName) as arrow.Vector | null;
    if (!column) return null;

    const type = column.type as arrow.DataType;
    let dimension = 0;
    if (arrow.DataType.isFixedSizeList(type)) {
        dimension = (type as arrow.FixedSizeList).listSize;
    }

    const count = column.length;
    if (count === 0) return null;

    // Infer the dimension from the first non-null row when it is not fixed by the type.
    if (dimension === 0) {
        for (let i = 0; i < count; ++i) {
            const row = column.get(i) as ArrayLike<number> | null;
            if (row != null) {
                dimension = row.length;
                break;
            }
        }
    }
    if (dimension === 0) return null;

    const data = new Float32Array(count * dimension);
    for (let i = 0; i < count; ++i) {
        const row = column.get(i) as ArrayLike<number> | arrow.Vector<any> | null;
        if (row == null) continue;
        const base = i * dimension;
        const len = Math.min(row.length, dimension);
        for (let j = 0; j < len; ++j) {
            const v = (row as ArrayLike<number>)[j];
            data[base + j] = typeof v === 'number' ? v : Number(v);
        }
    }
    return { data, count, dimension };
}

/// The category assignment for the scatter plot: a per-point `Uint8Array` color
/// index plus the number of distinct categories and (optionally) their source
/// values for legend/tooltip use.
export interface CategoryAssignment {
    category: Uint8Array;
    categoryCount: number;
    /// The distinct source values in category-index order (at most 256 entries).
    values: unknown[];
}

/// Map an arbitrary Arrow column to a dense `Uint8Array` of category indices. The
/// first 256 distinct values (in first-seen order) get indices 0..255; any further
/// distinct values collapse into the last bucket. Null maps to category 0.
export function extractCategories(table: arrow.Table, columnName: string): CategoryAssignment | null {
    const column = table.getChild(columnName) as arrow.Vector | null;
    if (!column) return null;

    const count = column.length;
    const category = new Uint8Array(count);
    const indexByValue = new Map<unknown, number>();
    const values: unknown[] = [];

    for (let i = 0; i < count; ++i) {
        let v = column.get(i) as unknown;
        if (typeof v === 'bigint') v = Number(v);
        if (v == null) {
            category[i] = 0;
            continue;
        }
        let idx = indexByValue.get(v);
        if (idx === undefined) {
            if (values.length < 256) {
                idx = values.length;
                indexByValue.set(v, idx);
                values.push(v);
            } else {
                idx = 255;
            }
        }
        category[i] = idx;
    }

    return { category, categoryCount: Math.max(1, values.length), values };
}
