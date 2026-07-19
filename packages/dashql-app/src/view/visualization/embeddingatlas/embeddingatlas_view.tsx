import * as React from 'react';

import * as styles from '../visualization_view.module.css';
import { QueryExecutionState, QueryExecutionStatus } from '../../../connection/query_execution_state.js';
import { EmbeddingScatter, EmbeddingPoints } from './embedding_scatter.js';
import { EmbeddingAtlasSpec } from './embeddingatlas_spec.js';
import { extractCategories, extractEmbeddingMatrix } from './embedding_extraction.js';
import { stubProjectFirstTwoComponents } from './embedding_projection.js';

interface Props {
    query: QueryExecutionState | null;
    spec: EmbeddingAtlasSpec | null;
}

/// Renders an embedding table as an interactive 2D scatter plot.
///
/// Reads the query result, extracts the vector column into a row-major matrix,
/// projects it to 2D, and drives the WebGPU/WebGL2 EmbeddingScatter. Phase 1 uses a
/// stub projection (first two vector components); the real UMAP worker replaces it
/// in Phase 2 without changing this component's surface.
export function EmbeddingAtlasView(props: Props): React.ReactElement {
    const succeeded = props.query?.status === QueryExecutionStatus.SUCCEEDED;
    const resultTable = succeeded ? props.query?.resultTable ?? null : null;
    const spec = props.spec;

    const { points, error } = React.useMemo<{ points: EmbeddingPoints | null; error: string | null }>(() => {
        if (!spec || !resultTable) return { points: null, error: null };

        const matrix = extractEmbeddingMatrix(resultTable, spec.vectorColumn);
        if (!matrix) {
            return { points: null, error: `Could not read vector column "${spec.vectorColumn}"` };
        }

        // Phase 1: stub projection. Swapped for the UMAP worker in Phase 2.
        const projected = stubProjectFirstTwoComponents(matrix);

        let category: Uint8Array | null = null;
        let categoryCount = 1;
        if (spec.categoryColumn) {
            const cats = extractCategories(resultTable, spec.categoryColumn);
            if (cats) {
                category = cats.category;
                categoryCount = cats.categoryCount;
            }
        }

        return {
            points: { x: projected.x, y: projected.y, category, categoryCount },
            error: null,
        };
    }, [spec, resultTable]);

    if (!spec) {
        return <div className={styles.empty}>No visualization available</div>;
    }
    if (!succeeded) {
        return <div className={styles.empty}>Run the query to see the visualization</div>;
    }
    if (!resultTable) {
        return <div className={styles.empty}>Result is empty</div>;
    }
    if (error) {
        return <div className={styles.error}>{error}</div>;
    }
    if (!points || points.x.length === 0) {
        return <div className={styles.empty}>Result is empty</div>;
    }

    return (
        <div className={styles.root}>
            <EmbeddingScatter points={points} />
        </div>
    );
}
