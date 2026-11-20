import {
    ASYMMETRIC_MATCHERS_OBJECT, ChaiStyleAssertions, GLOBAL_EXPECT,
    JestAsymmetricMatchers, JestChaiExpect, JestExtend, chai, setState,
} from '@vitest/expect';
import { clearAllMocks, fn, resetAllMocks, restoreAllMocks, spyOn } from '@vitest/spy';

// The parts of Mocha's browser build that the shim uses
type TestFunction = (...args: unknown[]) => unknown;
interface MochaTest { timeout(milliseconds?: number): unknown }
interface MochaTestFunction {
    (title: string, test?: TestFunction): MochaTest | undefined;
    skip: MochaTestFunction;
    only: MochaTestFunction;
}
interface MochaSuiteFunction {
    (title: string, suite: () => void): unknown;
    skip: MochaSuiteFunction;
    only: MochaSuiteFunction;
}
type MochaHook = (hook: TestFunction) => unknown;
/// The functions of the BDD interface, the globals or those of a file
interface MochaContext {
    describe: MochaSuiteFunction;
    it: MochaTestFunction;
    before: MochaHook;
    after: MochaHook;
    beforeEach: MochaHook;
    afterEach: MochaHook;
}
interface MochaSuite {
    __dashqlFile?: string;
    emit(event: string, ...args: unknown[]): void;
}
type TestOptions = number | { timeout?: number };

// Mocha's browser BDD globals are installed before this module is imported.
const globals = globalThis as typeof globalThis & MochaContext & {
    [ASYMMETRIC_MATCHERS_OBJECT]: object;
    mocha: { suite: MochaSuite };
    Mocha: {
        interfaces: { bdd(suite: MochaSuite): void };
        Suite: { constants: { EVENT_FILE_PRE_REQUIRE: string }; create(parent: MochaSuite, title: string): MochaSuite };
    };
};
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

let context: MochaContext = globals;
export function setTestFile(file: string): void {
    const suite = globals.Mocha.Suite.create(globals.mocha.suite, file);
    suite.__dashqlFile = file;
    globals.Mocha.interfaces.bdd(suite);
    context = {} as MochaContext;
    suite.emit(globals.Mocha.Suite.constants.EVENT_FILE_PRE_REQUIRE, context, file, globals.mocha);
}
const describe = Object.assign(
    (title: string, suite: () => void) => context.describe(title, suite),
    {
        skip: (title: string, suite: () => void) => context.describe.skip(title, suite),
        only: (title: string, suite: () => void) => context.describe.only(title, suite),
    },
);
const beforeAll = (hook: TestFunction) => context.before(hook);
const afterAll = (hook: TestFunction) => context.after(hook);
const beforeEach = (hook: TestFunction) => context.beforeEach(hook);
const afterEach = (hook: TestFunction) => context.afterEach(hook);
function register(base: MochaTestFunction, title: string, optionsOrTest?: TestOptions | TestFunction, maybeTest?: TestFunction): MochaTest | undefined {
    if (typeof optionsOrTest === 'function' || optionsOrTest == null) return base(title, optionsOrTest);
    const test = base(title, maybeTest);
    test?.timeout(typeof optionsOrTest === 'number' ? optionsOrTest : optionsOrTest.timeout);
    return test;
}
const it = Object.assign(
    (title: string, optionsOrTest?: TestOptions | TestFunction, maybeTest?: TestFunction) => register(context.it, title, optionsOrTest, maybeTest),
    {
        skip: (title: string, optionsOrTest?: TestOptions | TestFunction, maybeTest?: TestFunction) => register(context.it.skip, title, optionsOrTest, maybeTest),
        only: (title: string, optionsOrTest?: TestOptions | TestFunction, maybeTest?: TestFunction) => register(context.it.only, title, optionsOrTest, maybeTest),
        each: (cases: readonly unknown[]) => (title: string, test: TestFunction) => {
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
