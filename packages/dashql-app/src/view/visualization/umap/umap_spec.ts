/// The UMAP projection spec, mirroring the JSON emitted by the analyzer's
/// `GenerateUmapSpec` (see packages/dashql-core/src/visualize/vegalite_generator.cc).
export interface UmapProjectionSpec {
    /// Projection method. Currently only "umap".
    method: string;
    /// Distance metric ("cosine" | "euclidean"), if specified.
    metric?: string;
    /// UMAP nNeighbors, if specified.
    neighbors?: number;
    /// UMAP minDist, if specified.
    minDist?: number;
}

/// The parsed UMAP spec attached to a resolved VISUALIZE query.
export interface UmapSpec {
    /// The column holding the embedding vectors (FLOAT[] / list-of-float).
    vectorColumn: string;
    /// Optional column mapped to a per-point color category.
    categoryColumn?: string;
    /// Optional column shown in tooltips.
    labelColumn?: string;
    /// The projection sub-spec.
    projection: UmapProjectionSpec;
}

/// Parse the analyzer's `umap_spec` JSON string into a typed spec.
/// Returns null if the JSON is malformed or is missing the required vector column.
export function parseUmapSpec(raw: string): UmapSpec | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed == null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.vectorColumn !== 'string' || obj.vectorColumn.length === 0) return null;

    const projectionRaw = (obj.projection ?? {}) as Record<string, unknown>;
    const projection: UmapProjectionSpec = {
        method: typeof projectionRaw.method === 'string' ? projectionRaw.method : 'umap',
    };
    if (typeof projectionRaw.metric === 'string') projection.metric = projectionRaw.metric;
    if (typeof projectionRaw.neighbors === 'number') projection.neighbors = projectionRaw.neighbors;
    if (typeof projectionRaw.minDist === 'number') projection.minDist = projectionRaw.minDist;

    return {
        vectorColumn: obj.vectorColumn,
        categoryColumn: typeof obj.categoryColumn === 'string' ? obj.categoryColumn : undefined,
        labelColumn: typeof obj.labelColumn === 'string' ? obj.labelColumn : undefined,
        projection,
    };
}
