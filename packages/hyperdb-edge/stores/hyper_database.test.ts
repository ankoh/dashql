import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DatabaseInUseError } from '../src/node/database_lock.js';
import { HyperDatabase } from './hyper_database.js';
import { bytes, json, reals, text } from './sql.js';

describe('HyperDatabase', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'hyper-stores-'));
    const file = path.join(folder, 'state.hyper');
    let database: HyperDatabase;

    beforeAll(async () => {
        database = await HyperDatabase.open({ file });
        await database.execute(`CREATE TABLE ${database.table('t')} (id bigint, v text)`);
    });
    afterAll(async () => {
        await database?.close();
    });

    it('keeps a second engine away from the file', async () => {
        await expect(HyperDatabase.open({ file })).rejects.toBeInstanceOf(DatabaseInUseError);
    });

    it('round-trips texts longer than a literal may be', async () => {
        const value = `'quoted' \\ backslash 😀 ${'x'.repeat(3_000_000)} ünïcode`;
        const [row] = await database.query(`SELECT ${text(value)} AS v`);
        expect(row.v).toBe(value);
    });

    it('round-trips json as its text', async () => {
        const value = { b: 1, a: [1.5, 'it\'s', null, { nested: '😀' }], text: 'y'.repeat(2_000_000) };
        const [row] = await database.query(`SELECT ${json(value)} AS v`);
        expect(JSON.parse(row.v as string)).toEqual(value);
    });

    it('round-trips bytes and reals', async () => {
        const value = new Uint8Array(1_500_000).map((_, i) => i % 251);
        const [row] = await database.query(`SELECT ${bytes(value)} AS b, ${reals([0.5, -1, 1e-7])} AS r`);
        expect(row.b).toEqual(value);
        expect(row.r).toEqual([0.5, -1, Math.fround(1e-7)]);
    });

    it('commits a transaction or nothing of it', async () => {
        await expect(
            database.transaction(async (tx) => {
                await tx.execute(`INSERT INTO ${database.table('t')} VALUES (1, 'rolled back')`);
                throw new Error('stop');
            }),
        ).rejects.toThrow('stop');
        await database.transaction((tx) => tx.execute(`INSERT INTO ${database.table('t')} VALUES (2, 'committed')`));
        expect(await database.query(`SELECT id, v FROM ${database.table('t')}`)).toEqual([{ id: 2n, v: 'committed' }]);
    });

    it('runs concurrent calls one at a time, in order', async () => {
        const inserts = Array.from({ length: 20 }, (_, i) => database.execute(`INSERT INTO ${database.table('t')} VALUES (${100 + i}, 'c')`));
        const count = database.query(`SELECT count(*) AS n FROM ${database.table('t')} WHERE v = 'c'`);
        await Promise.all(inserts);
        expect(await count).toEqual([{ n: 20n }]);
    });

    it('keeps its tables when opened again', async () => {
        const rows = await database.query(`SELECT id, v FROM ${database.table('t')} ORDER BY id`);
        await database.close();
        database = await HyperDatabase.open({ file });
        expect(await database.query(`SELECT id, v FROM ${database.table('t')} ORDER BY id`)).toEqual(rows);
        expect(rows.length).toBeGreaterThan(0);
    });
});
