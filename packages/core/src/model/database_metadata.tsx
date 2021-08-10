import React from 'react';
import * as Immutable from 'immutable';
import * as arrow from 'apache-arrow';
import { Action, Dispatch, ProviderProps } from './model_context';

/// A column summary type
export enum TableStatisticsType {
    COUNT_STAR = 0,
    MINIMUM_VALUE = 1,
    MAXIMUM_VALUE = 2,
    DISTINCT_VALUES = 3,
}

/// A table statistics key
export type TableStatisticsKey = number;
/// Build a key for table statistics by concatenating the type and the column idx
export function buildTableStatisticsKey(type: TableStatisticsType, column_id = 0): TableStatisticsKey {
    return (column_id << 3) | (type as number);
}
/// Load the statistics type from a table statistics key
export function getTableStatisticsType(key: TableStatisticsKey): TableStatisticsType {
    return (key & 0b111) as TableStatisticsType;
}
/// Load the column id from a table statistics key
export function getTableStatisticsColumn(key: TableStatisticsKey): TableStatisticsType {
    return key >> 3;
}

/// A table metadatStorea
export type TableMetadata = {
    /// The statistics
    readonly statistics: Immutable.Map<TableStatisticsType, arrow.Column>;
};

/// A database metadata
export type DatabaseMetadata = {
    /// The tables
    readonly tables: Immutable.Map<string, TableMetadata>;
};

const initialState: DatabaseMetadata = {
    tables: Immutable.Map<string, TableMetadata>(),
};

export const ADD_TABLE_STATS = Symbol('ADD_TABLE_STATS');
export const DROP_TABLE_METADATA = Symbol('DROP_TABLE_METADATA');

export type DatabaseMetadataAction =
    | Action<typeof ADD_TABLE_STATS, [string, IterableIterator<[TableStatisticsType, arrow.Column]>]>
    | Action<typeof DROP_TABLE_METADATA, string>;

const reducer = (state: DatabaseMetadata, action: DatabaseMetadataAction) => {
    switch (action.type) {
        case ADD_TABLE_STATS: {
            const [name, stats] = action.data;
            const table = state.tables.get(name);
            if (!table) return state;
            const merged = table.statistics.withMutations(s => {
                for (const [key, value] of stats) {
                    s.set(key, value);
                }
            });
            return {
                ...state,
                tables: state.tables.set(name, {
                    ...table,
                    statistics: merged,
                }),
            };
        }
        case DROP_TABLE_METADATA:
            return {
                ...state,
                tables: state.tables.delete(action.data),
            };
    }
    return state;
};

const stateCtx = React.createContext<DatabaseMetadata>(initialState);
const dispatchCtx = React.createContext<Dispatch<DatabaseMetadataAction>>(() => {});

export const DatabaseMetadataProvider: React.FC<ProviderProps> = (props: ProviderProps) => {
    const [s, d] = React.useReducer(reducer, initialState);
    return (
        <stateCtx.Provider value={s}>
            <dispatchCtx.Provider value={d}>{props.children}</dispatchCtx.Provider>
        </stateCtx.Provider>
    );
};

export const useDatabaseMetadata = (): DatabaseMetadata => React.useContext(stateCtx);
export const useDatabaseMetadataDispatch = (): Dispatch<DatabaseMetadataAction> => React.useContext(dispatchCtx);
