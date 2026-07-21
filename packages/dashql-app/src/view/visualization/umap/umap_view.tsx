import * as React from 'react';

import * as styles from '../visualization.module.css';
import { QueryExecutionState, QueryExecutionStatus } from '../../../connection/query_execution_state.js';
import { EmbeddingScatter, EmbeddingPoints } from './embedding_scatter.js';
import { UmapSpec } from './umap_spec.js';
import { extractCategories } from './umap_categories.js';
import { useComputationRegistry } from '../../../compute/computation_registry.js';
import { LIST_COLUMN } from '../../../compute/computation_types.js';
import { extractFloat32Column } from '../../../compute/umap/umap_extraction.js';
import { resolveVisibleRowIndices } from '../../query_result/visible_rows.js';

interface Props {
    query: QueryExecutionState | null;
    spec: UmapSpec | null;
    /// Render the scatter with a transparent background so it blends into its container.
    transparent?: boolean;
    /// Enable pan/drag on the scatter. Defaults to true.
    interactive?: boolean;
    /// Enable scroll-wheel zoom. Disabled in the feed footer so the wheel scrolls the feed.
    /// Defaults to true.
    wheelZoom?: boolean;
}

/// Renders an embedding table as an interactive 2D scatter plot.
///
/// The projection is no longer computed here: when the query resolves a `'umap'`
/// visualize spec, `analyzeTable` runs the UMAP projection as a post-processing step,
/// appends the `x`/`y` coordinates to the analyzed table, and records their field names
/// on the embedding column's group.
/// This view is a pure renderer — it reads those coordinate columns out of the
/// computation state and drives the WebGPU/WebGL2 EmbeddingScatter. No worker, no
/// cache, no effect.
export function UmapView(props: Props): React.ReactElement {
    const [computationState] = useComputationRegistry();
    const spec = props.spec;
    const succeeded = props.query?.status === QueryExecutionStatus.SUCCEEDED;
    const queryId = props.query?.queryId ?? null;

    const tableComputation = queryId != null ? computationState.tableComputations[queryId] ?? null : null;

    // Locate the embedding column's group in the analyzed table's column groups and read
    // the projected coordinate columns by the generated field names recorded on it (an
    // internal detail of the compute module, not a hard-coded string).
    //
    // We render the FULL point cloud at all times and express the active cross-filter as a
    // per-point selection bitmask: selected (filter-matching) points stay at full opacity,
    // the rest are dimmed by the renderer. Ordering is intentionally NOT reflected here — it
    // only changes display order, which has no meaning in a scatter, so ordering alone dims
    // nothing. Only a `filterTable` produces a selection.
    const filterTable = tableComputation?.filterTable ?? null;
    const points = React.useMemo<EmbeddingPoints | null>(() => {
        if (!tableComputation) return null;
        const umapGroup = tableComputation.columnGroups.find(
            g => g.type === LIST_COLUMN && g.value.umapProjection != null);
        if (!umapGroup || umapGroup.type !== LIST_COLUMN || umapGroup.value.umapProjection == null) return null;

        const dataTable = tableComputation.dataTable;
        const x = extractFloat32Column(dataTable, umapGroup.value.umapProjection.xFieldName);
        const y = extractFloat32Column(dataTable, umapGroup.value.umapProjection.yFieldName);
        if (!x || !y) return null;

        const categories = spec?.categoryColumn ? extractCategories(dataTable, spec.categoryColumn) : null;
        const category = categories?.category ?? null;

        // Build a selection bitmask from the filtered row set (1-based row numbers → 0-based
        // positional indices, already resolved by `resolveVisibleRowIndices`). A null result
        // means no filter is active, so the whole cloud renders at full opacity.
        const selectedRows = filterTable != null ? resolveVisibleRowIndices(tableComputation) : null;
        let selection: Uint32Array | null = null;
        if (selectedRows != null) {
            selection = new Uint32Array(Math.ceil(x.length / 32));
            for (let i = 0; i < selectedRows.length; ++i) {
                const row = selectedRows[i];
                if (row >= 0 && row < x.length) {
                    selection[row >>> 5] |= 1 << (row & 31);
                }
            }
        }

        return {
            x,
            y,
            category,
            categoryCount: categories?.categoryCount ?? 1,
            selection,
        };
    }, [tableComputation, spec, filterTable]);

    if (!spec) {
        return <div className={styles.empty}>No visualization available</div>;
    }
    if (!succeeded) {
        return <div className={styles.empty}>Run the query to see the visualization</div>;
    }
    if (!points) {
        // The projection is computed inside the (blocking) post-processing step, so by
        // the time the query SUCCEEDED the coordinates are present. Until then, show a
        // projecting placeholder.
        return <div className={styles.empty}>Projecting embeddings…</div>;
    }
    if (points.x.length === 0) {
        return <div className={styles.empty}>Result is empty</div>;
    }

    return (
        <div className={styles.root_flush}>
            <EmbeddingScatter
                points={points}
                transparent={props.transparent}
                interactive={props.interactive}
                wheelZoom={props.wheelZoom}
            />
        </div>
    );
}
