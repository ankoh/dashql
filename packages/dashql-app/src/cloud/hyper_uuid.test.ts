import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { HyperDB, HyperDBConnection } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import { createTestHyperDB } from '../tests/hyperdb_test_client.js';
import { createTableSQL, insertStatements } from './cloud_sql.js';

// What the cloud store relies on when it keeps ids as uuid in Hyper. Database.com is Hyper, the embedded Hyper speaks
// for it.

let database: HyperDB;
let dispose: () => Promise<void>;
let connection: HyperDBConnection;

const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const OTHER = '00000000-0000-4000-8000-000000000001';

beforeAll(async () => {
    const test = await createTestHyperDB('dashql-hyper-uuid');
    database = test.database;
    dispose = test.dispose;
    connection = await database.connect();
}, 60_000);
afterAll(async () => {
    await connection?.close();
    await dispose?.();
});

async function texts(sql: string): Promise<unknown[]> {
    return [...await connection.query(sql)].map(row => row.toJSON().u);
}

describe('uuid in Hyper', () => {
    it('writes the text of a UUID through the inserts of the store and reads it back as text', async () => {
        const columns = [{ name: 'u', type: 'uuid', nullable: false }, { name: 'n', type: 'integer', nullable: false }];
        await connection.execute(createTableSQL('"ids"', columns));
        for (const statement of insertStatements('"ids"', columns, [[ID, '1'], [OTHER.toUpperCase(), '2'], [`{${ID}}`, '3']], 1024)) {
            await connection.execute(statement);
        }
        // Any case, with braces, comes back as lowercase text with dashes
        expect(await texts(`SELECT CAST(u AS text) AS u FROM "ids" ORDER BY n`)).toEqual([ID, OTHER, ID]);
        expect(await texts(`SELECT CAST(u AS text) AS u FROM "ids" ORDER BY u, n`)).toEqual([OTHER, ID, ID]);
    });

    it('compares a uuid with the text of a UUID', async () => {
        expect(await texts(`SELECT CAST(count(*) AS integer) AS u FROM "ids" WHERE u = '${ID}'`)).toEqual([2]);
        expect(await texts(`SELECT CAST(count(*) AS integer) AS u FROM "ids" WHERE u IN ('${OTHER}', '${ID.toUpperCase()}')`)).toEqual([3]);
        expect(await texts(`SELECT CAST(count(*) AS integer) AS u FROM "ids" a WHERE NOT EXISTS (SELECT 1 FROM "ids" b WHERE b.u = a.u AND b.n <> a.n)`)).toEqual([1]);
    });

    it('creates a table with a null uuid and updates it', async () => {
        await connection.execute(`CREATE TABLE "lock" AS SELECT CAST(NULL AS uuid) AS u`);
        await connection.execute(`UPDATE "lock" SET u = '${ID}' WHERE u IS NULL`);
        expect(await texts(`SELECT CAST(u AS text) AS u FROM "lock"`)).toEqual([ID]);
    });

    it('rejects text that is no UUID', async () => {
        await expect(connection.execute(`INSERT INTO "ids" VALUES ('${ID.slice(1)}', 4)`)).rejects.toThrow('invalid input syntax for uuid');
        await expect(connection.execute(`INSERT INTO "ids" SELECT CAST(v.c0 AS uuid), 4 FROM (VALUES ('x')) AS v(c0)`)).rejects.toThrow('invalid input syntax for uuid');
    });

    it('does not return a uuid as Arrow, the store selects its text', async () => {
        // Once Hyper returns a uuid as Arrow, the casts of the store to text can go
        await expect(connection.query(`SELECT u FROM "ids"`)).rejects.toThrow('unsupported SQL type during conversion to Arrow');
    });
});
