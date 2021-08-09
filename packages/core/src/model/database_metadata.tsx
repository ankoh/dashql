// Copyright (c) 2020 The DashQL Authors

import * as Immutable from 'immutable';
import * as arrow from 'apache-arrow';
import React, { createContext, useReducer } from 'react';
import { Action, Dispatch, StoreProviderProps } from './store_context';

/// A table type
export enum TableType {
    TABLE = 0,
    VIEW = 1,
}

/// A table info
export interface TableInfo {
    /// The table name
    readonly tableName: string;
    /// The table type
    readonly tableType: TableType;
    /// The column names
    readonly columnNames: string[];
    /// The column name indices
    readonly columnNameMapping: Map<string, number>;
    /// The column types
    readonly columnTypes: arrow.DataType[];
    /// The statistics
    readonly statistics: Immutable.Map<TableStatisticsType, arrow.Column>;
    /// The file path (if any)
    readonly filePath?: string;
}

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

type State = {
    tables: Immutable.Map<string, TableInfo>;
};

const initialState: State = {
    tables: Immutable.Map<string, TableInfo>(),
};

export const INSERT_TABLE_INFO = Symbol('INSERT_TABLE_INFO');
export const UPDATE_TABLE_INFO = Symbol('UPDATE_TABLE_INFO');

type ActionVariant =
    | Action<typeof INSERT_TABLE_INFO, TableInfo>
    | Action<typeof UPDATE_TABLE_INFO, [string, TableInfo]>;

const reducer = (state: State, action: ActionVariant) => {
    switch (action.type) {
        case INSERT_TABLE_INFO:
        case UPDATE_TABLE_INFO:
            break;
    }
    return state;
};

const stateCtx = createContext<State>(initialState);
const dispatchCtx = createContext<Dispatch<ActionVariant>>(() => {});

export const DatabaseMetadataProvider: React.FC<StoreProviderProps> = (props: StoreProviderProps) => {
    const [s, d] = useReducer(reducer, initialState);
    return (
        <stateCtx.Provider value={s}>
            <dispatchCtx.Provider value={d}>{props.children}</dispatchCtx.Provider>
        </stateCtx.Provider>
    );
};

export const useDatabaseMetadata = (): State => React.useContext(stateCtx);
export const useDatabaseMetadataDispatch = (): Dispatch<ActionVariant> => React.useContext(dispatchCtx);
