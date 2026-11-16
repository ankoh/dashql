import {
    ASYMMETRIC_MATCHERS_OBJECT, ChaiStyleAssertions, GLOBAL_EXPECT,
    JestAsymmetricMatchers, JestChaiExpect, JestExtend, chai, setState,
} from '@vitest/expect';
import { clearAllMocks, fn, resetAllMocks, restoreAllMocks, spyOn } from '@vitest/spy';

// Mocha's browser BDD globals are installed before this module is imported.
const globals = globalThis as any;
chai.use(JestExtend);
chai.use(JestChaiExpect);
chai.use(ChaiStyleAssertions);
chai.use(JestAsymmetricMatchers);
const expect = Object.assign(
    (value: unknown, message?: string) => chai.expect(value, message),
    chai.expect,
    globals[ASYMMETRIC_MATCHERS_OBJECT],
);
setState({ assertionCalls: 0 }, expect);
Object.defineProperty(globalThis, GLOBAL_EXPECT, { configurable: true, value: expect, writable: true });

let context = globals;
export function setTestFile(file: string): void {
    const suite = globals.Mocha.Suite.create(globals.mocha.suite, file);
    suite.__dashqlFile = file;
    globals.Mocha.interfaces.bdd(suite);
    context = {};
    suite.emit(globals.Mocha.Suite.constants.EVENT_FILE_PRE_REQUIRE, context, file, globals.mocha);
}
const describe = Object.assign(
    (title: string, suite: () => void) => context.describe(title, suite),
    {
        skip: (title: string, suite: () => void) => context.describe.skip(title, suite),
        only: (title: string, suite: () => void) => context.describe.only(title, suite),
    },
);
const beforeAll = (hook: (...args: any[]) => any) => context.before(hook);
const afterAll = (hook: (...args: any[]) => any) => context.after(hook);
const beforeEach = (hook: (...args: any[]) => any) => context.beforeEach(hook);
const afterEach = (hook: (...args: any[]) => any) => context.afterEach(hook);
function register(base: any, title: string, optionsOrTest?: any, maybeTest?: any): any {
    if (typeof optionsOrTest === 'function' || optionsOrTest == null) return base(title, optionsOrTest);
    const test = base(title, maybeTest);
    test?.timeout(typeof optionsOrTest === 'number' ? optionsOrTest : optionsOrTest.timeout);
    return test;
}
const it = Object.assign(
    (title: string, optionsOrTest?: any, maybeTest?: any) => register(context.it, title, optionsOrTest, maybeTest),
    {
        skip: (title: string, optionsOrTest?: any, maybeTest?: any) => register(context.it.skip, title, optionsOrTest, maybeTest),
        only: (title: string, optionsOrTest?: any, maybeTest?: any) => register(context.it.only, title, optionsOrTest, maybeTest),
        each: (cases: readonly unknown[]) => (title: string, test: (...args: any[]) => any) => {
            cases.forEach((testCase, index) => {
                const values = Array.isArray(testCase) ? testCase : [testCase];
                let valueIndex = 0;
                const name = title.replace(/%[sdifjo#]/g, token => token === '%#' ? String(index) : String(values[valueIndex++]));
                register(context.it, name, () => test(...values));
            });
        },
    },
);
const test = it;
/// Call the callback until it doesn't throw, its last error after the timeout, as vi.waitFor of Vitest
async function waitFor<T>(callback: () => T | Promise<T>, options: number | { timeout?: number; interval?: number } = {}): Promise<T> {
    const { timeout = 1000, interval = 50 } = typeof options === 'number' ? { timeout: options } : options;
    const deadline = Date.now() + timeout;
    for (;;) {
        try {
            return await callback();
        } catch (error) {
            if (Date.now() >= deadline) throw error;
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
}
const vi = { clearAllMocks, fn, resetAllMocks, restoreAllMocks, spyOn, waitFor };
Object.assign(globalThis, { describe, beforeAll, afterAll, beforeEach, afterEach, expect, it, test, vi });
export { describe, beforeAll, afterAll, beforeEach, afterEach, expect, it, test, vi };
