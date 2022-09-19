import { TopLevelSpec } from 'vega-lite/build/src/spec/index.js';

export interface VizSpec {
    readonly renderer: CardRenderer;
}

export type CardRenderer = TableRenderer | VegaLiteRenderer;

export interface TableRenderer {
    readonly t: 'Table';
    readonly v: {
        table_name: string;
        row_count?: number;
    };
}

export interface VegaLiteRenderer {
    readonly t: 'VegaLite';
    readonly v: {
        table_name: string;
        sampling?: SamplingMethod;
        spec: TopLevelSpec;
    };
}

export type SamplingMethod = ReservoirSampling | AM4Sampling;

export interface ReservoirSampling {
    readonly t: 'Reservoir';
    readonly v: number;
}

export interface AM4Sampling {
    readonly t: 'AM4';
    readonly v: {
        attribute_x: string;
        attribute_y: string;
        domain_x: any[];
    };
}
