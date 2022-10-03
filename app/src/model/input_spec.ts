import { ScalarValue } from './scalar_value';

export interface InputSpec {
    readonly value_type: string;
    readonly default_value: ScalarValue;
    readonly renderer: InputRenderer;
}

export type InputRenderer = InputTextRendererData;

export interface InputTextRendererData {
    readonly t: 'Text';
    readonly v: {
        placeholder: string;
    };
}
