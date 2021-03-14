// Copyright (c) 2020 The DashQL Authors

import { PlanObject } from './plan_object';
import { AggregatedFieldDef } from 'vega-lite/src/transform';
import { LogicalComposition } from 'vega-lite/src/logical';
import { Predicate } from 'vega-lite/src/predicate';
import { SortField } from 'vega-lite/src/sort';
import * as v from 'vega';
import * as vl from 'vega-lite';
import * as webdb from '@dashql/webdb';

export enum VizRendererType {
    BUILTIN_TABLE,
    BUILTIN_VEGA,
}

export interface VizInfo extends PlanObject {
    readonly renderer: VizRendererType;
    readonly currentStatementId: number;
    readonly position: VizPosition;
    readonly title: string | null;
    readonly vegaLiteSpec: vl.TopLevelSpec | null;
    readonly vegaSpec: v.Spec | null;
    readonly dataSource: VizDataSource;
}

export enum VizQueryType {
    PIECEWISE_SCAN,
    RESERVOIR_SAMPLE,
    M4,
}

export interface VizDataSource {
    readonly queryType: VizQueryType;
    readonly targetQualified: string;
    readonly predicates: LogicalComposition<Predicate>[];
    readonly aggregates: AggregatedFieldDef[];
    readonly orderBy: SortField[];
    readonly m4Attribute: string | null;
    readonly m4Domain: webdb.Value[];
    readonly rowCount: number | null;
    readonly sampleSize: number;
}

export interface VizPosition {
    readonly row: number;
    readonly column: number;
    readonly width: number;
    readonly height: number;
}
