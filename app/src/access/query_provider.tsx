import * as React from 'react';
import { Table } from 'apache-arrow/table';
import { useWorkflowSession } from '../backend/workflow_session';

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
    children: (result: Table) => React.ReactElement;
}

interface QueryState {
    /// The query in flight
    queryInFlight: Query | null;
    /// The result query
    resultQuery: Query | null;
    /// The result data
    resultData: Table | null;
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
    const session = useWorkflowSession();
    const [queryState, setQueryState] = React.useState<QueryState>({
        queryInFlight: null,
        resultQuery: null,
        resultData: null,
        error: null,
    });
    React.useEffect(() => {
        if (
            session == null ||
            queryState.queryInFlight != null ||
            (queryState.resultQuery && queryEquals(props.query, queryState.resultQuery))
        ) {
            return;
        }
        const query = props.query;
        const promise = (async () => {
            try {
                if (query.before) {
                    await session.runQuery(query.before);
                }
                return await session.runQuery(query.data);
            } catch (e) {
                console.error(e);
                throw e;
            } finally {
                try {
                    if (query.after) {
                        await session.runQuery(query.after);
                    }
                } catch (e) {
                    console.error(e);
                }
            }
        })();
        setQueryState({
            ...queryState,
            queryInFlight: query,
        });
        promise
            .then((result: Table): void => {
                setQueryState({
                    queryInFlight: null,
                    resultQuery: query,
                    resultData: result,
                    error: null,
                });
            })
            .catch(err => {
                setQueryState({
                    queryInFlight: null,
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
