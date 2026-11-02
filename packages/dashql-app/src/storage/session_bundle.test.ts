import * as dashql from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { bundleCatalogPath, filterInvalidSessionCatalogs, reconcileStoredSessionFiles, renameBundleCatalogs, type SessionBundle, type SessionBundleCatalog } from './session_bundle.js';
import { SessionTestBackend, TEST_CONNECTION_ID, TEST_SESSION_ID, testSession } from './session_test_backend.js';
import type { SessionData } from './storage_backend.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql.resetUnsafe();
});

const bundleOf = (...catalogs: SessionBundleCatalog[]): SessionBundle => ({ session: {} as SessionData, catalogs, scripts: [] });

describe('filterInvalidSessionCatalogs', () => {
    it('keeps a bundle with catalogs that parse', () => {
        const bundle = bundleOf({ connectionId: 'c1', relations: 'create table t (a int);', functions: null });
        expect(filterInvalidSessionCatalogs(dql, bundle)).toEqual({ bundle, invalidFiles: [] });
        expect(filterInvalidSessionCatalogs(dql, bundle).bundle).toBe(bundle);
    });

    it('drops the catalog files that do not parse', () => {
        const bundle = bundleOf(
            { connectionId: 'c1', relations: 'create table t (a int);', functions: 'create function (' },
            { connectionId: 'c2', relations: 'create tabel t;', functions: null },
        );
        const { bundle: filtered, invalidFiles } = filterInvalidSessionCatalogs(dql, bundle);
        expect(filtered.catalogs).toEqual([
            { connectionId: 'c1', relations: 'create table t (a int);', functions: null },
            { connectionId: 'c2', relations: null, functions: null },
        ]);
        expect(invalidFiles).toHaveLength(2);
        expect(invalidFiles[0].startsWith(bundleCatalogPath('c1', ''))).toBe(true);
        expect(invalidFiles[1].startsWith(bundleCatalogPath('c2', ''))).toBe(true);
    });
});

describe('renameBundleCatalogs', () => {
    it('renames the connections and keeps the first catalog of merged connections', () => {
        const catalog = (connectionId: string, relations: string) => ({ connectionId, relations, functions: null });
        expect(renameBundleCatalogs([catalog('a', 'A'), catalog('b', 'B'), catalog('c', 'C')], new Map([['a', 'x'], ['b', 'x']]))).toEqual([
            catalog('x', 'A'),
            catalog('c', 'C'),
        ]);
    });
});

describe('reconcileStoredSessionFiles', () => {
    it('lists the stored scripts and attachments and writes the session file only when they changed', async () => {
        const backend = new SessionTestBackend();
        backend.sessions.set(TEST_SESSION_ID, testSession());
        await backend.saveScript(TEST_SESSION_ID, 'a.sql', 'select 1');
        await backend.saveDataFile(TEST_SESSION_ID, 'd.parquet', new Uint8Array([1]));

        const session = await reconcileStoredSessionFiles(backend, TEST_SESSION_ID);
        expect(session.scripts.map(script => [script.name, script.connectionId])).toEqual([['a.sql', TEST_CONNECTION_ID]]);
        expect(session.attachments).toEqual([{ name: 'd.parquet' }]);
        expect(backend.sessions.get(TEST_SESSION_ID)).toEqual(session);

        const writes = backend.calls.filter(call => call.startsWith('manifest:')).length;
        await reconcileStoredSessionFiles(backend, TEST_SESSION_ID);
        expect(backend.calls.filter(call => call.startsWith('manifest:')).length).toBe(writes);
    });
});

