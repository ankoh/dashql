import { TopLevelSpec } from 'vega-lite/build/src/spec/index.js';

export interface VizSpec {
    readonly renderer: CardRendererData;
}

export type CardRendererData = TableRendererData | VegaLiteRendererData;

export interface TableRendererData {
    readonly t: 'Table';
    readonly v: {
        table_name: string;
        row_count?: number;
    };
}

export interface VegaLiteRendererData {
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
