import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { HyperDB } from 'hyperdb-wasm';

import { CsvSniffer } from './index.js';

// The query of the sniffer in the CSV reader of Hyper (hyperdb-wasm in Node, which reads files of the host by their
// path): every file is scanned, read and checked by its values
describe('reading a scanned CSV file with Hyper', { timeout: 60_000 }, () => {
    const folder = mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'csv-sniffer-'));
    let sniffer: CsvSniffer;
    let database: HyperDB;
    beforeAll(async () => {
        sniffer = await CsvSniffer.create();
        database = await HyperDB.create({ storagePath: mkdtempSync(path.join(folder, 'storage-')) });
    });
    afterAll(async () => {
        await database?.terminate();
    });

    /// Scan a file, read its data with Hyper and return its rows as plain objects with the types of the columns
    async function read(parts: BlobPart[]): Promise<{ types: string[]; rows: Record<string, unknown>[] }> {
        const scan = await sniffer.scan(new Blob(parts), { chunkBytes: 7 });
        try {
            expect(scan.schema.problems).toEqual([]);
            const file = path.join(folder, `${crypto.randomUUID()}.csv`);
            writeFileSync(file, new Uint8Array(await scan.data.arrayBuffer()));
            const connection = await database.connect();
            try {
                const table = await connection.query(scan.selectQuery(file));
                return {
                    types: scan.schema.columns.map(c => c.type),
                    rows: table.toArray().map(row => ({ ...row.toJSON() })),
                };
            } finally {
                await connection.close();
            }
        } finally {
            scan.release();
        }
    }

    it('reads the native types', async () => {
        const { types, rows } = await read([
            'id,name,score,ok,day,at\n',
            '1,ann,1.5,true,2024-01-31,2024-01-31 10:00:00\n',
            '2,,2.25,false,01/02/2024,2024-02-01T11:30:00\n',
            '3,"c, d",,yes,,\n',
        ]);
        expect(types).toEqual(['BIGINT', 'TEXT', 'DOUBLE PRECISION', 'BOOLEAN', 'DATE', 'TIMESTAMP']);
        expect(rows.map(r => r.id)).toEqual([1n, 2n, 3n]);
        expect(rows.map(r => r.name)).toEqual(['ann', null, 'c, d']);
        expect(rows.map(r => r.score)).toEqual([1.5, 2.25, null]);
        expect(rows.map(r => r.ok)).toEqual([true, false, true]);
        expect(rows.map(r => r.day)).toEqual([Date.UTC(2024, 0, 31), Date.UTC(2024, 0, 2), null]);
        expect(rows.map(r => r.at)).toEqual([Date.UTC(2024, 0, 31, 10), Date.UTC(2024, 1, 1, 11, 30), null]);
    });

    it('reads NULL words, quoted empty strings and dates with the day first', async () => {
        const { types, rows } = await read([
            'n;day;dots;flag\n',
            '1;31/01/2024;31.01.2024;y\n',
            'NA;01/02/2024;1.2.2024;""\n',
            '3;15/03/2024;N/A;n\n',
        ]);
        expect(types).toEqual(['BIGINT', 'DATE', 'DATE', 'BOOLEAN']);
        expect(rows.map(r => r.n)).toEqual([1n, null, 3n]);
        expect(rows.map(r => r.day)).toEqual([Date.UTC(2024, 0, 31), Date.UTC(2024, 1, 1), Date.UTC(2024, 2, 15)]);
        expect(rows.map(r => r.dots)).toEqual([Date.UTC(2024, 0, 31), Date.UTC(2024, 1, 1), null]);
        expect(rows.map(r => r.flag)).toEqual([true, null, false]);
    });

    it('reads a file after its preamble, without the blank lines at its end, and a file that is no UTF-8', async () => {
        const preamble = await read(['# a comment\n', '\n', 'a,b\r\n', '1,x\r\n', '2,y\r\n', '3,z\r\n', '\r\n', '\r\n']);
        expect(preamble.rows).toEqual([{ a: 1n, b: 'x' }, { a: 2n, b: 'y' }, { a: 3n, b: 'z' }]);
        // "Größe" and "Fläche" in windows-1252
        const encode = (text: string) => [...new TextEncoder().encode(text)];
        const latin = await read([new Uint8Array([...encode('Name;Gr'), 0xF6, 0xDF, ...encode('e\nFl'), 0xE4, ...encode('che;1\nB;2\nC;3\n')])]);
        expect(latin.rows.map(r => Object.values(r))).toEqual([['Fläche', 1n], ['B', 2n], ['C', 3n]]);
        expect(Object.keys(latin.rows[0])).toEqual(['Name', 'Größe']);
    });
});
