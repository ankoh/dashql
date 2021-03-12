// Copyright (c) 2020 The DashQL Authors

import { PlanObject } from './plan_object';
import * as v from 'vega';
import * as vl from 'vega-lite';

export enum VizRendererType {
    BUILTIN_TABLE,
    BUILTIN_VEGA,
}

export interface VizInfo extends PlanObject {
    readonly renderer: VizRendererType;
    readonly currentStatementId: number;
    readonly position: VizPosition;
    readonly data: VizDataSource;
    readonly title: string | null;
    readonly vegaLiteSpec: vl.TopLevelSpec | null;
    readonly vegaSpec: v.Spec | null;
}

export interface VizDataSource {
    readonly targetQualified: string;
    readonly targetShort: string;
    readonly columns: number[];
    readonly orderBy: number[];
    readonly partitionBy: number[];
}

export interface VizPosition {
    readonly row: number;
    readonly column: number;
    readonly width: number;
    readonly height: number;
}
