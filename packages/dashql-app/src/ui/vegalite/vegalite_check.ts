import { stringifyError } from '../../platform/logger/logger.js';
import { loadVega } from './vegalite_loader.js';

/// The logger that Vega-Lite reports problems to
type VegaLiteLogger = NonNullable<NonNullable<Parameters<typeof import('vega-lite').compile>[1]>['logger']>;

/// The problems of a Vega-Lite spec: the errors and warnings of compiling it without data
export async function checkVegaLiteSpec(spec: Record<string, unknown>): Promise<string[]> {
    const { vegaLite } = await loadVega();
    const problems: string[] = [];
    const collect = (...message: unknown[]) => {
        problems.push(message.map(m => (typeof m === 'string' ? m : stringifyError(m))).join(' '));
        return logger;
    };
    const logger: VegaLiteLogger = { level: () => logger, error: collect, warn: collect, info: () => logger, debug: () => logger };
    try {
        vegaLite.compile({ ...spec, data: { values: [] } } as Parameters<typeof vegaLite.compile>[0], { logger });
    } catch (e: unknown) {
        problems.push(stringifyError(e));
    }
    return problems;
}
