import mochaUrl from 'mocha/mocha.js?url';

export interface BrowserMochaTest {
    __dashqlFile?: string;
    duration?: number;
    parent?: BrowserMochaSuite;
    title: string;
    titlePath(): string[];
}

export interface BrowserMochaSuite {
    __dashqlFile?: string;
    parent?: BrowserMochaSuite;
    suites: BrowserMochaSuite[];
    tests: BrowserMochaTest[];
    emit(event: string, ...args: unknown[]): void;
}

export interface BrowserMochaSuiteConstructor {
    constants: { EVENT_FILE_PRE_REQUIRE: string };
    create(parent: BrowserMochaSuite, title: string): BrowserMochaSuite;
}

export interface BrowserMochaRunner {
    failures: number;
    total: number;
    on(event: string, callback: (...args: any[]) => void): void;
}

export interface BrowserMocha {
    run(callback?: () => void): BrowserMochaRunner;
    suite: BrowserMochaSuite;
    setup(options: Record<string, unknown> | string): void;
}

declare global {
    var mocha: BrowserMocha;
    var Mocha: {
        interfaces: { bdd(suite: BrowserMochaSuite): void };
        Runner: {
            constants: Record<string, string>;
            immediately(callback: () => void): void;
        };
        Suite: BrowserMochaSuiteConstructor;
    };
}

let loading: Promise<BrowserMocha> | null = null;

/// Run the steps of Mocha in message tasks. Its browser build waits for a setTimeout(0) after asynchronous tests and
/// hooks, and browsers clamp these nested timers to 4ms, which adds up over the whole suite.
function scheduleMochaWithoutTimers(): void {
    const steps: (() => void)[] = [];
    const channel = new MessageChannel();
    channel.port1.onmessage = () => steps.shift()!();
    globalThis.Mocha.Runner.immediately = step => {
        steps.push(step);
        channel.port2.postMessage(null);
    };
}

export function loadBrowserMocha(): Promise<BrowserMocha> {
    if (globalThis.mocha) return Promise.resolve(globalThis.mocha);
    loading ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = mochaUrl;
        script.onload = () => {
            scheduleMochaWithoutTimers();
            resolve(globalThis.mocha);
        };
        script.onerror = () => reject(new Error(`Failed to load Mocha from ${mochaUrl}`));
        document.head.append(script);
    });
    return loading;
}

export function getBrowserMocha(): BrowserMocha {
    if (!globalThis.mocha) throw new Error('Mocha must be loaded before importing test modules');
    return globalThis.mocha;
}
