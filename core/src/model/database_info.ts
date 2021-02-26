// Copyright (c) 2020 The DashQL Authors

import * as Immutable from "immutable";
import { PlanObject } from "./plan_object";
import * as webdb from '@dashql/webdb';

/// A column summary type
export enum ColumnSummaryType {
    COUNT_STAR,
    MINIMUM_VALUE,
    MAXIMUM_VALUE,
}

/// A column statistic
export interface ColumnStatistic {
    /// The column id
    readonly column_id: number;
    /// The statistics type
    readonly type: ColumnSummaryType;
    /// The value
    readonly value: webdb.Value;
}

/// A database table info
export interface DatabaseTableInfo extends PlanObject {
    /// The column names
    readonly columnNames: string[];
    /// The column type
    readonly columnTypes: webdb.SQLType[];
    /// The row count
    readonly rowCount?: number;
    /// The column summaries 
    readonly column_summaries?: Immutable.List<ColumnStatistic>;
}