export interface InputSpec {
    readonly value_type: string;
    readonly renderer: InputRenderer;
}

export type InputRenderer = InputTextRendererData;

export interface InputTextRendererData {
    readonly t: 'InputTextRendererData';
    readonly v: {
        placeholder: string;
    };
}