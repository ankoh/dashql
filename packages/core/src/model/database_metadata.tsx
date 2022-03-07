// Copyright (c) 2021 The DashQL Authors

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
/// A table type
export enum TableType {
    TABLE = 0,
    VIEW = 1,
}

/// A table metadatStorea
export interface TableMetadata {
    /// The qualified name
    readonly nameQualified: string;
    /// The table type
    readonly tableType: TableType;
    /// The table id (if any)
    readonly tableID: number | null;
    /// The script (if any)
    readonly script: string | null;
    /// The column names
    readonly columnNames: string[];
    /// The column name indices
    readonly columnNameMapping: Map<string, number>;
    /// The column types
    readonly columnTypes: arrow.DataType[];
    /// The statistics
    readonly statistics: Immutable.Map<TableStatisticsType, arrow.Vector>;
}

/// A database metadata
export type DatabaseMetadata = {
    /// The tables
    readonly tables: Immutable.Map<string, TableMetadata>;
};

export const initialDatabaseMetadata: DatabaseMetadata = {
    tables: Immutable.Map<string, TableMetadata>(),
};

export const ADD_TABLE_METADATA = Symbol('ADD_TABLE_METADATA');
export const ADD_TABLE_STATS = Symbol('ADD_TABLE_STATS');
export const UPDATE_TABLE_METADATA = Symbol('UPDATE_TABLE_METADATA');
export const DROP_TABLE_METADATA = Symbol('DROP_TABLE_METADATA');

export type DatabaseMetadataAction =
    | Action<typeof ADD_TABLE_METADATA, [string, TableMetadata]>
    | Action<typeof ADD_TABLE_STATS, [string, IterableIterator<[TableStatisticsType, arrow.Vector]>]>
    | Action<typeof UPDATE_TABLE_METADATA, [string, Partial<TableMetadata>]>
    | Action<typeof DROP_TABLE_METADATA, string>;

export const reduceDatabaseMetadata = (ctx: DatabaseMetadata, action: DatabaseMetadataAction): DatabaseMetadata => {
    switch (action.type) {
        case ADD_TABLE_METADATA: {
            const [name, data] = action.data;
            const prev = ctx.tables.get(name);
            if (!prev) {
                return {
                    ...ctx,
                    tables: ctx.tables.set(name, data),
                };
            }
            const merged = prev.statistics.withMutations(s => {
                for (const [key, value] of data.statistics) {
                    s.set(key, value);
                }
            });
            return {
                ...ctx,
                tables: ctx.tables.set(name, {
                    ...prev,
                    statistics: merged,
                }),
            };
        }
        case ADD_TABLE_STATS: {
            const [name, stats] = action.data;
            const prev = ctx.tables.get(name);
            if (!prev) return ctx;
            const merged = prev.statistics.withMutations(s => {
                for (const [key, value] of stats) {
                    s.set(key, value);
                }
            });
            return {
                ...ctx,
                tables: ctx.tables.set(name, {
                    ...prev,
                    statistics: merged,
                }),
            };
        }
        case UPDATE_TABLE_METADATA: {
            const [tableName, tableUpdate] = action.data;
            const table = ctx.tables.get(tableName);
            if (!table) return ctx;
            return {
                ...ctx,
                tables: ctx.tables.set(table.nameQualified, {
                    ...table,
                    ...tableUpdate,
                }),
            };
        }
        case DROP_TABLE_METADATA:
            return {
                ...ctx,
                tables: ctx.tables.delete(action.data),
            };
    }
};

const stateCtx = React.createContext<DatabaseMetadata>(initialDatabaseMetadata);
const dispatchCtx = React.createContext<Dispatch<DatabaseMetadataAction>>(() => {});

export const DatabaseMetadataProvider: React.FC<ProviderProps> = (props: ProviderProps) => {
    const [s, d] = React.useReducer(reduceDatabaseMetadata, initialDatabaseMetadata);
    return (
        <stateCtx.Provider value={s}>
            <dispatchCtx.Provider value={d}>{props.children}</dispatchCtx.Provider>
        </stateCtx.Provider>
    );
};

export const useDatabaseMetadata = (): DatabaseMetadata => React.useContext(stateCtx);
export const useDatabaseMetadataDispatch = (): Dispatch<DatabaseMetadataAction> => React.useContext(dispatchCtx);
