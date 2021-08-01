// Copyright (c) 2020 The DashQL Authors

import * as proto from '@dashql/proto';
import * as v from 'vega';
import { PlanObject } from './plan_object';
import { InputExtra } from './input';
import { TopLevelSpec } from 'vega-lite/build/src/spec/index.js';
import { AggregatedFieldDef } from 'vega-lite/build/src/transform.js';
import { LogicalComposition } from 'vega-lite/build/src/logical.js';
import { Predicate } from 'vega-lite/build/src/predicate.js';
import { SortField } from 'vega-lite/build/src/sort.js';
import { DateTime } from 'vega-lite/build/src/datetime.js';
import { ExprRef } from 'vega-lite/build/src/expr.js';

export enum CardRendererType {
    BUILTIN_HEX,
    BUILTIN_INPUT_FILE,
    BUILTIN_INPUT_TEXT,
    BUILTIN_JSON,
    BUILTIN_TABLE,
    BUILTIN_VEGA,
}

export interface CardSpecification extends PlanObject {
    readonly cardType: proto.analyzer.CardType | null;
    readonly cardRenderer: CardRendererType;
    readonly statementID: number;
    readonly position: CardPosition;
    readonly title: string | null;
    readonly inputExtra: InputExtra | null;
    readonly vegaLiteSpec: TopLevelSpec | null;
    readonly vegaSpec: v.Spec | null;
    readonly dataSource: CardDataSource | null;
    readonly visible: boolean;
}

export type DomainValue = null | string | number | boolean | ExprRef | v.SignalRef | DateTime;
export type DomainValues = DomainValue[];

export interface M5Config {
    attributeX: string;
    attributeY: string;
    domainX: DomainValues;
}

export enum CardDataResolver {
    PIECEWISE_SCAN,
    RESERVOIR_SAMPLE,
    M5,
}

export interface CardDataSource {
    readonly dataResolver: CardDataResolver;
    readonly targetQualified: string;
    readonly filters: LogicalComposition<Predicate>[] | null;
    readonly aggregates: AggregatedFieldDef[] | null;
    readonly orderBy: SortField[] | null;
    readonly m5Config: M5Config | null;
    readonly sampleSize: number;
}

export interface CardPosition {
    readonly row: number;
    readonly column: number;
    readonly width: number;
    readonly height: number;
}
