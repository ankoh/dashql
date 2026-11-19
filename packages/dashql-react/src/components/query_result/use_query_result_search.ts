import * as React from 'react';

import type { ComputationView } from '@akohn/dashql';
import type { ComputationDispatch } from '../data_table/data_table.js';

/// The column and the data search of a table. The runtime runs the searches: a search that the user types starts once
/// the data frame of the table is there, a newer one supersedes it, an empty pattern ends it.
export function useQueryResultSearch(
    table: ComputationView | null,
    dispatch: ComputationDispatch,
) {
    const setColumnPattern = React.useCallback((pattern: string) => {
        dispatch({ kind: 'setResultSearchPattern', value: { search: 'columns', pattern } });
    }, [dispatch]);
    const setDataPattern = React.useCallback((pattern: string) => {
        dispatch({ kind: 'setResultSearchPattern', value: { search: 'data', pattern } });
    }, [dispatch]);

    return {
        columnSearch: table?.columnSearch ?? null,
        dataSearch: table?.dataSearch ?? null,
        setColumnPattern,
        setDataPattern,
    };
}
