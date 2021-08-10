// Copyright (c) 2020 The DashQL Authors

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
    /// The file path (if any)
    readonly filePath?: string;
}
