import * as dashql from './index.js';

import { loadCoreWasm, NO_OAUTH } from './test_fixture.js';

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
            get: handle => objects.get(handle),
            duplicate: handle => {
                objects.set(next, objects.get(handle));
                return next++;
            },
        },
        tables: {
            begin: () => { throw new Error('no tables'); },
            append: () => { throw new Error('no tables'); },
            finish: () => { throw new Error('no tables'); },
            read: () => { throw new Error('no tables'); },
            describe: () => { throw new Error('no tables'); },
            open: () => { throw new Error('no tables'); },
            push: () => { throw new Error('no tables'); },
        },
        compute: null,
        http: { fetch: () => Promise.reject(new Error('no http')), abort: () => { } },
        channels: {
            connect: () => Promise.reject(new Error('no channels')),
            hyperLinkToken: () => null,
            describe: () => Promise.reject(new Error('no channels')),
            forget: () => { },
            open: () => Promise.reject(new Error('no channels')),
            next: () => Promise.reject(new Error('no channels')),
            cancel: async () => { },
            profileDetail: () => { },
        },
        resultCache: null,
        crypto: { randomUuid: () => 'uuid', sha256: () => Promise.reject(new Error('no digests')) },
        oauth: NO_OAUTH,
        extensions: { loadSpec: () => Promise.reject(new Error('no extensions')) },
        storage: null,
        archives: null,
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
        expect(runtime.dispatch({ computation: 1 }, { kind: 'deleteComputation' })).toEqual({ ok: true, changed: false, error: null, id: null });
        expect(runtime.dispatch({ computation: 1 }, { kind: 'orderBy', value: { constraints: [{ field: 'a', ascending: false }] } }).changed).toBe(false);
        expect(runtime.dispatch({ computation: 1 }, { kind: 'histogramFilter', value: { columnGroup: 1, selection: [0, 2] } }).ok).toBe(true);
        expect(runtime.dispatch({ computation: 1 }, { kind: 'setResultSearchPattern', value: { search: 'data', pattern: 'x' } }).ok).toBe(true);
        expect(changed).toEqual([]);
        runtime.free();
    });

    it('refuses or throws on arguments of the wrong type instead of trapping the module', () => {
        const runtime = dql!.createRuntime(platform().platform);
        const unchecked = runtime as unknown as {
            dispatch(target: unknown, action: unknown): unknown;
            views(kind: unknown, ids: unknown): unknown;
            analyzeTable(tableId: unknown, table: unknown, options: unknown): unknown;
        };
        // A dispatch never throws, it refuses what it can't read
        expect(unchecked.dispatch({ computation: 'one' }, { kind: 'deleteComputation' })).toMatchObject({ ok: false });
        expect(unchecked.dispatch({ notebook: 'a' }, { kind: 'deleteComputation' })).toMatchObject({ ok: false });
        expect(unchecked.dispatch({ kind: 'deleteComputation' }, { computation: 1 })).toMatchObject({ ok: false });
        expect(unchecked.dispatch({ computation: 1 }, { kind: 'orderBy', value: { constraints: 'a' } })).toMatchObject({ ok: false });
        expect(unchecked.dispatch({ computation: 1 }, { kind: 'unknown' })).toMatchObject({ ok: false });
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
