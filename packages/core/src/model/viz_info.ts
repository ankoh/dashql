// Copyright (c) 2020 The DashQL Authors

import { PlanObject } from './plan_object';
import * as v from 'vega';
import { TopLevelSpec } from 'vega-lite/build/src/spec/index.js';
import { AggregatedFieldDef } from 'vega-lite/build/src/transform.js';
import { LogicalComposition } from 'vega-lite/build/src/logical.js';
import { Predicate } from 'vega-lite/build/src/predicate.js';
import { SortField } from 'vega-lite/build/src/sort.js';
import { DateTime } from 'vega-lite/build/src/datetime.js';
import { ExprRef } from 'vega-lite/build/src/expr.js';

export enum VizRendererType {
    BUILTIN_TABLE,
    BUILTIN_VEGA,
}

export interface VizInfo extends PlanObject {
    readonly currentStatementId: number;
    readonly position: VizPosition;
    readonly title: string | null;
    readonly renderer: VizRendererType | null;
    readonly vegaLiteSpec: TopLevelSpec | null;
    readonly vegaSpec: v.Spec | null;
    readonly dataSource: VizDataSource | null;
}

export enum VizQueryType {
    PIECEWISE_SCAN,
    RESERVOIR_SAMPLE,
    M5,
}

export type DomainValue = null | string | number | boolean | ExprRef | v.SignalRef | DateTime;
export type DomainValues = DomainValue[];

export interface M5Config {
    attributeX: string;
    attributeY: string;
    domainX: DomainValues;
}

export interface VizDataSource {
    readonly queryType: VizQueryType;
    readonly targetQualified: string;
    readonly filters: LogicalComposition<Predicate>[] | null;
    readonly aggregates: AggregatedFieldDef[] | null;
    readonly orderBy: SortField[] | null;
    readonly m5Config: M5Config | null;
    readonly rowCount: number | null;
    readonly sampleSize: number;
}

export interface VizPosition {
    readonly row: number;
    readonly column: number;
    readonly width: number;
    readonly height: number;
}
