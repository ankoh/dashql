import * as v from 'vega';
import { TopLevelSpec } from 'vega-lite/build/src/spec/index.js';
import { LogicalComposition } from 'vega-lite/build/src/logical.js';
import { AggregatedFieldDef } from 'vega-lite/build/src/transform.js';
import { Predicate } from 'vega-lite/build/src/predicate.js';
import { SortField } from 'vega-lite/build/src/sort.js';
import { DateTime } from 'vega-lite/build/src/datetime.js';
import { ExprRef } from 'vega-lite/build/src/expr.js';

export enum CardRendererType {
    Table = 0,
    Vega = 1,
    InputCalendar = 101,
    InputText = 102,
    HexDump = 200,
    JsonInspector = 201,
}

export interface CardPosition {
    readonly row: number;
    readonly column: number;
    readonly width: number;
    readonly height: number;
}

export interface CardSpecification {
    readonly renderer: CardRendererType | null;
    readonly position: CardPosition;
    readonly title: string;
    readonly vegaLiteSpec?: TopLevelSpec | null;
    readonly dataSource?: CardDataSource | null;
}

export type DomainValue = null | string | number | boolean | ExprRef | v.SignalRef | DateTime;
export type DomainValues = DomainValue[];

export interface AM4Config {
    attributeX: string;
    attributeY: string;
    domainX: DomainValues;
}

export enum CardDataResolver {
    PiecewiseScan = 0,
    ReservoirSample = 1,
    AM4 = 2,
}

export interface CardDataSource {
    readonly dataResolver: CardDataResolver;
    readonly tableName: string;
    readonly filters?: LogicalComposition<Predicate>[];
    readonly aggregates?: AggregatedFieldDef[];
    readonly orderBy?: SortField[];
    readonly am4Config?: AM4Config;
    readonly sampleSize?: number;
}
