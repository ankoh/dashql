import { InputSpec } from './input_spec';
import { VizSpec } from './viz_spec';

export type WorkflowData = VizData | InputData;

export interface VizData {
    t: 'VizData';
    v: VizSpec;
}

export interface InputData {
    t: 'InputData';
    v: InputSpec;
}
