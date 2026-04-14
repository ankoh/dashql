import type { DemoParams } from '../connection_params.js';

export function createDemoConnectionParamsSignature(_params: DemoParams): any {
    return { case: "demo" };
}
