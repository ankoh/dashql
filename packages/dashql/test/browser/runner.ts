import mochaUrl from 'mocha/mocha.js?url';
import coreWasmUrl from './inputs/dependencies/dashql-wasm/dashql_core.wasm?url';

interface SerializedError { message: string; stack: string | null }
interface TestResult { titlePath: string[]; status: string; error: SerializedError | null }
interface FileResult { file: string; status: string; tests: TestResult[]; error: SerializedError | null; duration: number; started?: number }
interface Summary {
    status: string;
    files: FileResult[];
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
    activeTest?: string;
}
// The parts of Mocha's browser build that the runner uses, a test or a suite
interface MochaRunnable { __dashqlFile?: string; parent?: MochaRunnable; titlePath(): string[] }
interface MochaRunner { on(event: string, callback: (runnable: MochaRunnable, error?: unknown) => void): void }

const globals = globalThis as typeof globalThis & {
    __DASHQL_BROWSER_TESTS__: Summary;
    DASHQL_PRECOMPILED: Promise<Uint8Array>;
    mocha: { setup(options: Record<string, unknown>): void; run(callback: () => void): MochaRunner };
};
const summary: Summary = globals.__DASHQL_BROWSER_TESTS__ = {
    status: 'running', files: [], passed: 0, failed: 0, skipped: 0, duration: 0,
};
const started = performance.now();
const modules = import.meta.glob(['./inputs/src/core/**/*.test.ts', './*.test.ts']);
const requestedFile = new URLSearchParams(location.search).get('file');
const files = requestedFile
    ? [requestedFile.startsWith('src/') ? `./inputs/${requestedFile}` : `./${requestedFile}`]
    : Object.keys(modules).sort();
function serializeError(error: unknown): SerializedError {
    const { message, stack } = (error ?? {}) as { message?: string; stack?: string };
    return { message: message ?? String(error), stack: stack ?? null };
}

async function run(): Promise<void> {
    const script = document.createElement('script');
    script.src = mochaUrl;
    await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load Mocha from ${mochaUrl}`));
        document.head.append(script);
    });
    globals.mocha.setup({ ui: 'bdd', timeout: 60_000, checkLeaks: false, reporter: function SilentReporter() {} });
    const { setTestFile } = await import('./vitest_compat.js');
    // Fixtures may reuse a runtime, but the production factory never reads test globals.
    const { DashQL } = await import('./inputs/src/core/api.js');
    const create = DashQL.create.bind(DashQL);
    globals.DASHQL_PRECOMPILED = fetch(coreWasmUrl).then(async response => {
        if (!response.ok) throw new Error(`Failed to fetch core Wasm: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    });
    const wasmModule = await WebAssembly.compile((await globals.DASHQL_PRECOMPILED).slice().buffer);
    let instance: Promise<InstanceType<typeof DashQL>> | undefined;
    let resolvedInstance: InstanceType<typeof DashQL> | undefined;
    DashQL.create = async (options = {}) => {
        instance ??= create({
            ...options,
            wasmBinary: undefined,
            module: options.module ?? wasmModule,
        });
        return resolvedInstance = await instance;
    };
    const results = new Map<string, FileResult>();
    for (const path of files) {
        const result: FileResult = { file: path.replace(/^\.\/(inputs\/)?/, ''), status: 'running', tests: [], error: null, duration: 0 };
        summary.files.push(result);
        results.set(result.file, result);
        try {
            const load = modules[path];
            if (!load) throw new Error(`Unknown browser test file: ${result.file}`);
            setTestFile(result.file);
            await load();
        } catch (error) {
            result.error = serializeError(error);
            result.status = 'failed';
            summary.failed++;
        }
    }
    if (files.length === 0) throw new Error('No core browser test files found');
    await new Promise<void>(resolve => {
        const runner = globals.mocha.run(resolve);
        runner.on('test', test => {
            globals.__DASHQL_BROWSER_TESTS__.activeTest = test.titlePath().join(' > ');
        });
        runner.on('suite', suite => {
            const result = results.get(suite.__dashqlFile ?? '');
            if (result) result.started = performance.now();
        });
        for (const [event, status] of [['pass', 'passed'], ['fail', 'failed'], ['pending', 'skipped']] as const) {
            runner.on(event, (test, error) => {
                let suite = test.parent;
                while (suite && !suite.__dashqlFile) suite = suite.parent;
                const result = results.get(suite?.__dashqlFile ?? '');
                if (!result) throw new Error('Test registered outside a file suite');
                result.tests.push({ titlePath: test.titlePath(), status, error: error ? serializeError(error) : null });
                summary[status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'skipped']++;
            });
        }
        // The reset is synchronous: Mocha starts the next file immediately after this event.
        runner.on('suite end', suite => {
            const result = results.get(suite.__dashqlFile ?? '');
            if (!result) return;
            resolvedInstance?.resetUnsafe();
            result.duration = performance.now() - (result.started ?? NaN);
        });
    });
    for (const result of results.values()) {
        if (result.error) continue;
        if (result.tests.length === 0) {
            result.error = serializeError(new Error(`No tests registered for ${result.file}`));
            summary.failed++;
        }
        result.status = result.error || result.tests.some(test => test.status === 'failed') ? 'failed' : 'passed';
    }
}

void run().catch(error => {
    summary.failed++;
    summary.files.push({ file: '<harness>', status: 'failed', tests: [], error: serializeError(error) });
}).finally(() => {
    summary.duration = performance.now() - started;
    summary.status = summary.failed > 0 ? 'failed' : 'passed';
    document.getElementById('results')!.textContent = JSON.stringify(summary, null, 2);
});
