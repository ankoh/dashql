import * as React from 'react';

import type { UMAPOptions } from '@dashql/umap-wasm';

import * as styles from '../visualization.module.css';
import { QueryExecutionState, QueryExecutionStatus } from '../../../connection/query_execution_state.js';
import { EmbeddingScatter, EmbeddingPoints } from './embedding_scatter.js';
import { EmbeddingAtlasSpec } from './embeddingatlas_spec.js';
import { extractCategories, extractEmbeddingMatrix } from './embedding_extraction.js';
import { projectWithUMAP, Projection2D } from './embedding_projection.js';
import { projectionCacheKey, useEmbeddingProjectionRegistry } from './embedding_projection_registry.js';

interface Props {
    query: QueryExecutionState | null;
    spec: EmbeddingAtlasSpec | null;
    /// Render the scatter with a transparent background so it blends into its container.
    transparent?: boolean;
    /// Enable pan/drag on the scatter. Defaults to true.
    interactive?: boolean;
    /// Enable scroll-wheel zoom. Disabled in the feed footer so the wheel scrolls the feed.
    /// Defaults to true.
    wheelZoom?: boolean;
}

/// Map the analyzer's projection sub-spec to UMAP options, applying embedding-atlas's
/// defaults for anything the user left unspecified (metric cosine, nNeighbors 15,
/// minDist 0.1). `method` other than umap is not yet supported.
function umapOptionsFromSpec(spec: EmbeddingAtlasSpec): UMAPOptions {
    const p = spec.projection;
    const options: UMAPOptions = {
        metric: p.metric === 'euclidean' ? 'euclidean' : 'cosine',
    };
    if (typeof p.neighbors === 'number') options.nNeighbors = p.neighbors;
    if (typeof p.minDist === 'number') options.minDist = p.minDist;
    return options;
}

/// Renders an embedding table as an interactive 2D scatter plot.
///
/// Reads the query result, extracts the vector column into a row-major matrix,
/// projects it to 2D with UMAP in a web worker (progress streamed, cancelled on
/// unmount / re-run), and drives the WebGPU/WebGL2 EmbeddingScatter.
export function EmbeddingAtlasView(props: Props): React.ReactElement {
    const succeeded = props.query?.status === QueryExecutionStatus.SUCCEEDED;
    const resultTable = succeeded ? props.query?.resultTable ?? null : null;
    const spec = props.spec;
    const queryId = props.query?.queryId ?? null;

    // Projections are expensive to compute but this component is remounted often
    // (footer tab switches, card collapse, reopening the notebook). Cache the
    // result in a registry that outlives the component, keyed by query + spec, so
    // we only run UMAP once per (query result, projection options).
    const projectionCache = useEmbeddingProjectionRegistry();
    const cacheKey = (queryId != null && spec != null) ? projectionCacheKey(queryId, spec) : null;

    const [projection, setProjection] = React.useState<Projection2D | null>(() =>
        cacheKey != null ? projectionCache.get(cacheKey) : null
    );
    const [progress, setProgress] = React.useState<{ progress: number; stage: string } | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [running, setRunning] = React.useState(false);

    // Extract the category column synchronously (cheap); it does not depend on the
    // async projection and is re-derived when the source table or spec changes.
    const categories = React.useMemo(() => {
        if (!spec?.categoryColumn || !resultTable) return null;
        return extractCategories(resultTable, spec.categoryColumn);
    }, [spec, resultTable]);

    // Extract + project whenever the source table or spec changes. The projection
    // runs in a worker; we cancel it on cleanup so a stale result never lands.
    React.useEffect(() => {
        setError(null);
        setProgress(null);
        if (!spec || !resultTable || cacheKey == null || queryId == null) {
            setProjection(null);
            return;
        }

        // Reuse a previously computed projection for this query + spec instead of
        // re-running UMAP on every remount.
        const cached = projectionCache.get(cacheKey);
        if (cached) {
            setProjection(cached);
            setRunning(false);
            return;
        }

        const extraction = extractEmbeddingMatrix(resultTable, spec.vectorColumn);
        if (!extraction.ok) {
            setProjection(null);
            setError(extraction.error);
            return;
        }

        setProjection(null);
        setRunning(true);
        const run = projectWithUMAP(extraction.matrix, umapOptionsFromSpec(spec), (p, stage) => {
            setProgress({ progress: p, stage });
        });
        run.promise
            .then(result => {
                projectionCache.set(cacheKey, queryId, result);
                setProjection(result);
                setRunning(false);
                setProgress(null);
            })
            .catch((e: unknown) => {
                setRunning(false);
                setProgress(null);
                setError(e instanceof Error ? e.message : String(e));
            });

        return () => run.cancel();
    }, [spec, resultTable, cacheKey, queryId, projectionCache]);

    const points = React.useMemo<EmbeddingPoints | null>(() => {
        if (!projection) return null;
        return {
            x: projection.x,
            y: projection.y,
            category: categories?.category ?? null,
            categoryCount: categories?.categoryCount ?? 1,
        };
    }, [projection, categories]);

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
    if (running || !points) {
        const pct = progress ? Math.round(progress.progress * 100) : 0;
        const label = progress ? `Projecting embeddings (${progress.stage} ${pct}%)` : 'Projecting embeddings…';
        return <div className={styles.empty}>{label}</div>;
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
