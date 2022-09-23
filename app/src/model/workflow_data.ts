import { VizSpec } from './viz_spec';

export type WorkflowData = VizData;

export interface VizData {
    t: 'VizData';
    v: VizSpec;
}
