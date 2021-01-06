// Copyright (c) 2020 The DashQL Authors

//import * as charts from 'chart.js';

/// A viz spec
export type VizSpec<T, P> = {
    readonly type: T;
    readonly data: P;
};

/// A viz spec type
export enum VizSpecType {
    TABLE = 'TABLE',
    LINE_CHART = 'LINE_CHART'
}

/// A viz spec variant
export type VizSpecVariant =
    | VizSpec<VizSpecType.TABLE, TableVizSpec>
    | VizSpec<VizSpecType.LINE_CHART, LineChartSpec>
    ;

/// A position
export interface Position {
    x: number;
    y: number;
    width: number;
    height: number;
};

/// The viz base spec
export interface VizBaseSpec {
    position: Position;
}

/// A table viz specification
export interface TableVizSpec extends VizBaseSpec {
}

/// A line chart specification
export interface LineChartSpec extends VizBaseSpec {
}
