// Copyright (c) 2020 The DashQL Authors

import * as Immutable from 'immutable';
import { PlanObject } from './plan_object';
import * as arrow from 'apache-arrow';

/// A database table
export interface Table extends PlanObject {
    /// The column names
    readonly columnNames: string[];
    /// The column name indices
    readonly columnNameMapping: Map<string, number>;
    /// The column type
    readonly columnTypes: arrow.DataType[];
    /// The statistics
    readonly statistics: Immutable.Map<TableStatisticsType, arrow.Column>;
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
/// Extract the statistics type from a table statistics key
export function getTableStatisticsType(key: TableStatisticsKey): TableStatisticsType {
    return (key & 0b111) as TableStatisticsType;
}
/// Extract the column id from a table statistics key
export function getTableStatisticsColumn(key: TableStatisticsKey): TableStatisticsType {
    return key >> 3;
}
