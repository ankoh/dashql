import * as React from 'react';

import { UmapSpec } from './umap_spec.js';
import { Projection2D } from './embedding_projection.js';

/// Cache key for a projection. A UMAP projection is fully determined by the source
/// result table (identified by its query id), the vector column, and the UMAP
/// options (metric / neighbors / minDist). The category column only affects point
/// colouring, not the 2D coordinates, so it is intentionally excluded.
export function projectionCacheKey(queryId: number, spec: UmapSpec): string {
    const p = spec.projection;
    const metric = p.metric === 'euclidean' ? 'euclidean' : 'cosine';
    const neighbors = typeof p.neighbors === 'number' ? p.neighbors : 'default';
    const minDist = typeof p.minDist === 'number' ? p.minDist : 'default';
    return `${queryId} ${spec.vectorColumn} ${metric} ${neighbors} ${minDist}`;
}

interface ProjectionRegistryValue {
    get(key: string): Projection2D | null;
    set(key: string, queryId: number, projection: Projection2D): void;
    clearQuery(queryId: number): void;
}

const EMBEDDING_PROJECTION_CTX = React.createContext<ProjectionRegistryValue | null>(null);

/// Cache of computed UMAP projections that outlives the UmapView.
///
/// The scatter view is remounted whenever the user switches footer tabs, collapses
/// a card, or reopens the notebook, which used to discard the (expensive) UMAP
/// result held in local component state and re-run the projection every time. This
/// registry is mounted above the notebook feed so a projection computed once is
/// reused until the underlying query result or projection options change.
///
/// The registry value has a stable identity and is intentionally NOT reactive: the
/// component that computes a projection keeps it in local state, and a freshly
/// mounted view reads the cache synchronously on mount. Keeping it non-reactive
/// avoids re-running one card's in-flight projection when another card stores its
/// result.
export const useEmbeddingProjectionRegistry = () => React.useContext(EMBEDDING_PROJECTION_CTX)!;

interface EmbeddingProjectionRegistryProps {
    children: React.ReactElement[] | React.ReactElement;
}

export function EmbeddingProjectionRegistry(props: EmbeddingProjectionRegistryProps) {
    const projections = React.useRef<Map<string, Projection2D>>(new Map());
    const value = React.useMemo<ProjectionRegistryValue>(() => ({
        get: (key: string) => projections.current.get(key) ?? null,
        set: (key: string, queryId: number, projection: Projection2D) => {
            // Keep at most one cached projection per query id: a query only ever
            // shows one embedding view at a time, so drop any prior entry for the
            // same query (e.g. after the user changes the projection options).
            const prefix = `${queryId} `;
            for (const existing of projections.current.keys()) {
                if (existing !== key && existing.startsWith(prefix)) {
                    projections.current.delete(existing);
                }
            }
            projections.current.set(key, projection);
        },
        clearQuery: (queryId: number) => {
            const prefix = `${queryId} `;
            for (const existing of projections.current.keys()) {
                if (existing.startsWith(prefix)) {
                    projections.current.delete(existing);
                }
            }
        },
    }), []);
    return (
        <EMBEDDING_PROJECTION_CTX.Provider value={value}>
            {props.children}
        </EMBEDDING_PROJECTION_CTX.Provider>
    );
}
