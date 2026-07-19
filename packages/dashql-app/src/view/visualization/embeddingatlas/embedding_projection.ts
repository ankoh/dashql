import type { EmbeddingMatrix } from './embedding_extraction.js';

/// The 2D result of projecting an embedding matrix, split into the `x`/`y`
/// Float32Arrays the scatter renderer consumes.
export interface Projection2D {
    x: Float32Array;
    y: Float32Array;
}

/// Phase-1 stub projection: take the first two components of each vector as `(x, y)`.
///
/// This exists purely to prove the SQL → extraction → renderer pixels path end to
/// end before the real UMAP worker (workstream C/E) lands. It is deterministic and
/// synchronous. The output is NOT a meaningful embedding layout — for a 2D+ vector
/// it is a raw scatter of dims 0 and 1; for a 1D vector `y` is zeroed.
export function stubProjectFirstTwoComponents(matrix: EmbeddingMatrix): Projection2D {
    const { data, count, dimension } = matrix;
    const x = new Float32Array(count);
    const y = new Float32Array(count);
    for (let i = 0; i < count; ++i) {
        const base = i * dimension;
        x[i] = data[base];
        y[i] = dimension > 1 ? data[base + 1] : 0;
    }
    return { x, y };
}
