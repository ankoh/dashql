import { describe, expect, it } from 'vitest';

import { openTestHyperDBWindow, type TestHyperDBWindow } from '../../../tests/hyperdb_test_client.js';
import { getOPFSRoot, hyperOPFSRoot } from '@ankoh/dashql-sdk/platform/opfs_root';
import type { HyperDBConnection } from '../hyperdb_wasm.js';
import { EXPERIMENTAL_REDO_LOG_SETTING } from '../hyperdb_settings.js';

// The redo log of Hyper across a reload of the app. Hyper writes a database consistently only when no session attaches
// it anymore, a reload ends the engine worker without that. With the redo log, Hyper logs every commit next to the
// database file and the next attach replays it. The local cloud keeps its tables in such a database.
//
// A reload is a worker that is terminated while its session still attaches the database (openTestHyperDBWindow).

/// A database file in a folder of its own in the OPFS, the folder lists the files of the database
async function withDatabaseFolder(test: (path: string, files: () => Promise<Map<string, number>>) => Promise<void>): Promise<void> {
    const root = await getOPFSRoot();
    const name = `redo-log-${crypto.randomUUID()}`;
    const folder = await root.getDirectoryHandle(name, { create: true });
    const files = async () => {
        const sizes = new Map<string, number>();
        for await (const [entry, handle] of (folder as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
            if (handle.kind === 'file') sizes.set(entry, (await (handle as FileSystemFileHandle).getFile()).size);
        }
        return sizes;
    };
    try {
        await test(`${hyperOPFSRoot()}/${name}/data.hyper`, files);
    } finally {
        await root.removeEntry(name, { recursive: true }).catch(() => {});
    }
}

/// Open a window whose session attaches the database as "d"
async function openWindow(path: string, redoLog: boolean): Promise<TestHyperDBWindow> {
    return await openTestHyperDBWindow([{ path, alias: 'd' }], redoLog ? { [EXPERIMENTAL_REDO_LOG_SETTING]: true } : {});
}

async function rows(session: HyperDBConnection, sql: string): Promise<Record<string, unknown>[]> {
    return (await session.query(sql)).toArray().map(row => ({ ...row.toJSON() }));
}

/// Create tables, insert, update and delete, the changes that the local cloud makes
async function change(session: HyperDBConnection): Promise<void> {
    await session.execute('CREATE SCHEMA d.s');
    await session.execute('CREATE TABLE d.s.t (k integer NOT NULL, v text NOT NULL)');
    await session.execute(`INSERT INTO d.s.t VALUES (1, 'a'), (2, 'b'), (3, 'c')`);
    await session.execute(`UPDATE d.s.t SET v = 'B' WHERE k = 2`);
    await session.execute('DELETE FROM d.s.t WHERE k = 3');
    await session.execute('CREATE TABLE d.s.u AS SELECT 7 AS n');
}

const CHANGED = [{ k: 1, v: 'a' }, { k: 2, v: 'B' }];

describe('HyperDB Wasm redo log', () => {
    it('loses the changes to an attached database on a reload without the redo log', async () => {
        await withDatabaseFolder(async path => {
            const first = await openWindow(path, false);
            await change(first.session);
            await first.reload();
            const second = await openWindow(path, false);
            try {
                await expect(second.session.query('SELECT * FROM d.s.t')).rejects.toThrow();
            } finally {
                await second.close();
            }
        });
    }, 60_000);

    it('replays the changes to an attached database on a reload', async () => {
        await withDatabaseFolder(async (path, files) => {
            const first = await openWindow(path, true);
            await change(first.session);
            // Every commit is logged next to the database
            expect((await files()).get('data.hyper.dblog') ?? 0).toBeGreaterThan(1000);
            await first.reload();

            const second = await openWindow(path, true);
            try {
                expect(await rows(second.session, 'SELECT k, v FROM d.s.t ORDER BY k')).toEqual(CHANGED);
                expect(await rows(second.session, 'SELECT n FROM d.s.u')).toEqual([{ n: 7 }]);
                // The replay leaves the database writable
                await second.session.execute(`INSERT INTO d.s.t VALUES (4, 'd')`);
                expect(await rows(second.session, 'SELECT count(*) AS n FROM d.s.t')).toEqual([{ n: 3n }]);
            } finally {
                await second.close();
            }
        });
    }, 60_000);

    it('empties the redo log once the session detaches the database', async () => {
        await withDatabaseFolder(async (path, files) => {
            const first = await openWindow(path, true);
            await change(first.session);
            await first.close();
            expect((await files()).get('data.hyper.dblog') ?? 0).toBeLessThan(100);

            const second = await openWindow(path, true);
            try {
                expect(await rows(second.session, 'SELECT k, v FROM d.s.t ORDER BY k')).toEqual(CHANGED);
            } finally {
                await second.close();
            }
        });
    }, 60_000);

    // hyperdb-wasm before 0.0.27361 replayed a NULL of a nullable column as the zero value of its type
    it('replays NULLs on a reload', async () => {
        await withDatabaseFolder(async path => {
            const first = await openWindow(path, true);
            await first.session.execute('CREATE TABLE d.public.n (k integer NOT NULL, i integer, t text, b boolean, ts timestamptz, u uuid)');
            await first.session.execute('INSERT INTO d.public.n VALUES (1, NULL, NULL, NULL, NULL, NULL)');
            await first.session.execute(`INSERT INTO d.public.n VALUES (2, 5, 'x', true, '2026-01-01 00:00:00+00', '7c9e6679-7425-40de-944b-e07fc1f90ae7')`);
            await first.session.execute('INSERT INTO d.public.n (k) VALUES (3)');
            await first.reload();

            const second = await openWindow(path, true);
            try {
                expect(await rows(second.session, `
                    SELECT k, i IS NULL AS i, t IS NULL AS t, b IS NULL AS b, ts IS NULL AS ts, u IS NULL AS u
                    FROM d.public.n ORDER BY k
                `)).toEqual([1, 2, 3].map(k => {
                    const isNull = k !== 2;
                    return { k, i: isNull, t: isNull, b: isNull, ts: isNull, u: isNull };
                }));
                expect(await rows(second.session, `
                    SELECT k, i, t, b, ts = '2026-01-01 00:00:00+00' AS ts, u::text AS u
                    FROM d.public.n WHERE k = 2
                `)).toEqual([{ k: 2, i: 5, t: 'x', b: true, ts: true, u: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }]);
            } finally {
                await second.close();
            }
        });
    }, 60_000);
});
