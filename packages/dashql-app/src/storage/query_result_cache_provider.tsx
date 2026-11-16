import * as React from 'react';

import type { QueryResultCache } from '@akohn/dashql/platform/query/query_result_cache';
import { createOPFSQueryResultCache } from '@akohn/dashql/platform/storage/opfs_query_result_cache';

const CACHE_CTX = React.createContext<QueryResultCache | null>(null);

/// The query result cache of the app, null without a provider
export function useQueryResultCache(): QueryResultCache | null {
    return React.useContext(CACHE_CTX);
}

/// Provide the query result cache of the app, by default the one in the origin private file system
export function QueryResultCacheProvider(props: { cache?: QueryResultCache; children: React.ReactElement }) {
    const cache = React.useMemo(() => props.cache ?? createOPFSQueryResultCache(), [props.cache]);
    return <CACHE_CTX.Provider value={cache}>{props.children}</CACHE_CTX.Provider>;
}
