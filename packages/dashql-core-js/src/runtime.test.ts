import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});
afterEach(() => {
    dql!.resetUnsafe();
});

/// A platform without tables and without a compute database that records what the runtime tells it
function platform() {
    const changed: boolean[] = [];
    const objects = new Map<number, unknown>();
    let next = 1;
    const platform: dashql.RuntimePlatform = {
        clock: { now: () => 1000, sleep: () => Promise.resolve() },
        log: () => {},
        handles: {
            register: object => {
                objects.set(next, object);
                return next++;
            },
            release: handle => {
                objects.delete(handle);
            },
        },
        tables: {
            begin: () => { throw new Error('no tables'); },
            append: () => { throw new Error('no tables'); },
            finish: () => { throw new Error('no tables'); },
            read: () => { throw new Error('no tables'); },
        },
        compute: null,
        changed: urgent => {
            changed.push(urgent);
        },
    };
    return { platform, changed, objects };
}

describe('DashQL runtime', () => {
    it('starts without slices', () => {
        const runtime = dql!.createRuntime(platform().platform);
        expect(runtime.takeChanges()).toEqual({ changes: [], effects: [] });
        expect(runtime.views('computation', [1, 2])).toEqual([null, null]);
        runtime.destroy();
        runtime.free();
    });

    it('applies an action to a slice that is not there without a change', () => {
        const { platform: host, changed } = platform();
        const runtime = dql!.createRuntime(host);
        expect(runtime.dispatch({ computation: 1 }, { kind: 'deleteComputation' })).toEqual({ ok: true, changed: false, error: null });
        expect(runtime.dispatch({ computation: 1 }, { kind: 'orderBy', value: { constraints: [{ field: 'a', ascending: false }] } }).changed).toBe(false);
        expect(runtime.dispatch({ computation: 1 }, { kind: 'histogramFilter', value: { columnGroup: 1, selection: [0, 2] } }).ok).toBe(true);
        expect(runtime.dispatch({ computation: 1 }, { kind: 'setResultSearchPattern', value: { search: 'data', pattern: 'x' } }).ok).toBe(true);
        expect(changed).toEqual([]);
        runtime.free();
    });

    it('throws on arguments of the wrong type instead of trapping the module', () => {
        const runtime = dql!.createRuntime(platform().platform);
        const unchecked = runtime as unknown as {
            dispatch(target: unknown, action: unknown): unknown;
            views(kind: unknown, ids: unknown): unknown;
            analyzeTable(tableId: unknown, table: unknown, options: unknown): unknown;
        };
        expect(() => unchecked.dispatch({ computation: 'one' }, { kind: 'deleteComputation' })).toThrow();
        expect(() => unchecked.dispatch({ workbook: 'a' }, { kind: 'deleteComputation' })).toThrow();
        expect(() => unchecked.dispatch({ kind: 'deleteComputation' }, { computation: 1 })).toThrow();
        expect(() => unchecked.dispatch({ computation: 1 }, { kind: 'orderBy', value: { constraints: 'a' } })).toThrow();
        expect(() => unchecked.dispatch({ computation: 1 }, { kind: 'unknown' })).toThrow();
        expect(() => unchecked.views('computation', ['a'])).toThrow();
        expect(() => unchecked.views('computation', 1)).toThrow();
        expect(() => unchecked.views('workbook', [1])).toThrow();
        expect(() => unchecked.analyzeTable(1, -1, {})).toThrow();
        expect(() => unchecked.analyzeTable(1, 2, { columnAggregates: 'yes' })).toThrow();
        // A table that the platform can't read
        expect(() => unchecked.analyzeTable(1, 2, {})).toThrow(/no tables/);
        // The module is still usable
        expect(runtime.dispatch({ computation: 1 }, { kind: 'clearCrossFilters' }).ok).toBe(true);
        expect(runtime.takeChanges().changes).toEqual([]);
        runtime.free();
    });
});
