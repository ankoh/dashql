import { compileProblems, type VegaLiteCompile } from '@akohn/dashql/platform/workbook/chart_config';
import { loadVega } from './vegalite_loader.js';

/// The problems of a Vega-Lite spec: the errors and warnings of compiling it without data
export async function checkVegaLiteSpec(spec: Record<string, unknown>): Promise<string[]> {
    const { vegaLite } = await loadVega();
    return compileProblems(vegaLite.compile as unknown as VegaLiteCompile, spec);
}
