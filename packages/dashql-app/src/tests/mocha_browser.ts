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
        Runner: { constants: Record<string, string> };
        Suite: BrowserMochaSuiteConstructor;
    };
}

let loading: Promise<BrowserMocha> | null = null;

export function loadBrowserMocha(): Promise<BrowserMocha> {
    if (globalThis.mocha) return Promise.resolve(globalThis.mocha);
    loading ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = mochaUrl;
        script.onload = () => resolve(globalThis.mocha);
        script.onerror = () => reject(new Error(`Failed to load Mocha from ${mochaUrl}`));
        document.head.append(script);
    });
    return loading;
}

export function getBrowserMocha(): BrowserMocha {
    if (!globalThis.mocha) throw new Error('Mocha must be loaded before importing test modules');
    return globalThis.mocha;
}
