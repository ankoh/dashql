// Copyright (c) 2020 The DashQL Authors

import * as Immutable from 'immutable';
import { PlanObject } from './plan_object';
import * as arrow from 'apache-arrow';

/// A table type
export enum TableType {
    TABLE = 0,
    VIEW = 1,
}

/// A database table
export interface TableSummary extends PlanObject {
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