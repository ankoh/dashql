import * as React from 'react';
import * as arrow from 'apache-arrow';
import { useDatabaseClient } from '../database_client';

export interface Query {
    before?: string;
    data: string;
    after?: string;
}

interface Props {
    /// The query
    query: Query;

    /// The error component
    errorComponent?: ((error: string) => React.ReactElement) | null;
    /// The in-flight component
    inFlightComponent?: ((query: Query) => React.ReactElement) | null;
    /// The children
    children: (result: arrow.Table) => React.ReactElement;
}

interface QueryState {
    /// The query in flight
    queryInFlight: Query | null;
    /// The query promise
    queryPromise: Promise<arrow.Table> | null;
    /// The result query
    resultQuery: Query | null;
    /// The result data
    resultData: arrow.Table | null;
    /// The error
    error: string | null;
}

function queryEquals(l: Query, r: Query) {
    return (
        l.data == r.data &&
        ((!l.before && !r.before) || l.before == r.before) &&
        ((!l.after && !r.after) || l.after == r.after)
    );
}

export const QueryProvider: React.FC<Props> = (props: Props) => {
    const database = useDatabaseClient();
    const [queryState, setQueryState] = React.useState<QueryState>({
        queryInFlight: null,
        queryPromise: null,
        resultQuery: null,
        resultData: null,
        error: null,
    });
    const isMountedRef = React.useRef(true);
    React.useEffect(() => {
        return () => void (isMountedRef.current = false);
    }, []);
    React.useEffect(() => {
        if (
            queryState.queryInFlight != null ||
            (queryState.resultQuery && queryEquals(props.query, queryState.resultQuery))
        ) {
            return;
        }
        const query = props.query;
        const promise = database.use(async conn => {
            try {
                if (query.before) {
                    await conn.runQuery(query.before);
                }
                return await conn.runQuery(query.data);
            } catch (e) {
                console.error(e);
                throw e;
            } finally {
                try {
                    if (query.after) {
                        await conn.runQuery(query.after);
                    }
                } catch (e) {
                    console.error(e);
                }
            }
        });
        setQueryState({
            ...queryState,
            queryInFlight: query,
            queryPromise: promise,
        });
        promise
            .then((result: arrow.Table): void => {
                if (!isMountedRef.current) return;
                setQueryState({
                    queryInFlight: null,
                    queryPromise: null,
                    resultQuery: query,
                    resultData: result,
                    error: null,
                });
            })
            .catch(err => {
                if (!isMountedRef.current) return;
                setQueryState({
                    queryInFlight: null,
                    queryPromise: null,
                    resultQuery: query,
                    resultData: null,
                    error: err,
                });
            });
    }, [props.query, queryState.queryInFlight]);

    // Query in flight?
    if (queryState.queryInFlight && props.inFlightComponent) {
        return props.inFlightComponent(queryState.queryInFlight);
    }
    // Query failed?
    if (queryState.error && props.errorComponent) {
        return props.errorComponent(queryState.error);
    }
    // Query OK?
    if (queryState.resultData) {
        return props.children(queryState.resultData);
    }
    return <div />;
};