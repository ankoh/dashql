// Copyright (c) 2020 The DashQL Authors

import * as Immutable from 'immutable';
import { PlanObject } from './plan_object';
import * as webdb from '@dashql/webdb';

/// A database table info
export interface DatabaseTableInfo extends PlanObject {
    /// The qualified table name
    readonly tableNameQualified: string;
    /// The short table name
    readonly tableNameShort: string;
    /// The column names
    readonly columnNames: string[];
    /// The column name indices
    readonly columnNameMapping: Map<string, number>;
    /// The column type
    readonly columnTypes: webdb.SQLType[];
    /// The statistics
    readonly statistics: Immutable.Map<TableStatisticsType, webdb.Value[]>;
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
export function buildTableStatisticsKey(type: TableStatisticsType, column_id: number = 0): TableStatisticsKey {
    return (column_id << 3) | (type as number);
}
/// Extract the statistics type from a table statistics key
export function getTableStatisticsType(key: TableStatisticsKey): TableStatisticsType {
    return (key & 0b111) as TableStatisticsType;
}
/// Extract the column id from a table statistics key
export function getTableStatisticsColumn(key: TableStatisticsKey): TableStatisticsType {
    return key >> 3;
}
