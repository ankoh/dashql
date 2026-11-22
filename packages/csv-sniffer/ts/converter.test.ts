import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { HyperDB } from 'hyperdb-wasm';

import { convertCsv, CsvSniffer, inThreadRunner, type CsvConversion } from './index.js';

// The conversion to Parquet in parts, in the thread of the test, and the parts read as one table by Hyper
describe('converting a CSV file to Parquet in parts', { timeout: 60_000 }, () => {
    const folder = mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'csv-convert-'));
    let sniffer: CsvSniffer;
    let database: HyperDB;
    beforeAll(async () => {
        sniffer = await CsvSniffer.create();
        database = await HyperDB.create({ storagePath: mkdtempSync(path.join(folder, 'storage-')) });
    });
    afterAll(async () => {
        await database?.terminate();
    });

    /// Write the parts to files and read them with the query of the conversion
    async function readParts(conversion: CsvConversion): Promise<Record<string, unknown>[]> {
        const paths = await Promise.all(conversion.parts.map(async part => {
            const file = path.join(folder, `${crypto.randomUUID()}.parquet`);
            writeFileSync(file, new Uint8Array(await part.file.arrayBuffer()));
            return file;
        }));
        const connection = await database.connect();
        try {
            const table = await connection.query(`SELECT * FROM (${conversion.unionQuery(paths)}) ORDER BY 1`);
            return table.toArray().map(row => ({ ...row.toJSON() }));
        } finally {
            await connection.close();
        }
    }

    it('splits a file with quoted line breaks into parts that read every row once', async () => {
        const lines = ['id;text;amount;day\r\n'];
        for (let i = 0; i < 500; ++i) {
            const text = i % 3 === 0 ? `"note ${i}\r\nwith ""quotes""; and more"` : `plain ${i}`;
            lines.push(`${i};${text};${i}.25;2024-01-${String(i % 28 + 1).padStart(2, '0')}\r\n`);
        }
        const file = new Blob(lines);
        const sample = await sniffer.sample(file);
        try {
            expect(sample.schema.columns.map(c => c.type)).toEqual(['BIGINT', 'TEXT', 'DOUBLE PRECISION', 'DATE']);
            const progress: number[] = [];
            const conversion = await sniffer.convert(sample, {
                runner: inThreadRunner,
                maxWorkers: 7,
                minPartBytes: 1000,
                chunkBytes: 333,
                onProgress: read => progress.push(read),
            });
            expect(conversion.parts).toHaveLength(7);
            expect(conversion.rows).toBe(500);
            expect(progress.at(-1)).toBeGreaterThan(file.size * 0.9);
            const rows = await readParts(conversion);
            expect(rows.map(r => r.id)).toEqual(Array.from({ length: 500 }, (_, i) => BigInt(i)));
            expect(rows[3].text).toBe('note 3\r\nwith "quotes"; and more');
            expect(rows[4].text).toBe('plain 4');
            expect(rows[499].amount).toBe(499.25);
            expect(rows[27].day).toBe(Date.UTC(2024, 0, 28));
        } finally {
            sample.release();
        }
    });

    it('widens the columns of a part with a value that the sample missed and casts in the query', async () => {
        const lines = ['id,score\n'];
        for (let i = 0; i < 400; ++i) lines.push(`${i},${i % 7}\n`);
        lines.push('400,4.5\n');
        for (let i = 401; i < 800; ++i) lines.push(`${i},${i % 7}\n`);
        const file = new Blob(lines);
        // A sample of the first lines only, the conversion reads the whole file in four parts
        const sample = await sniffer.sample(new Blob(lines.slice(0, 100)));
        try {
            expect(sample.schema.columns.map(c => c.type)).toEqual(['BIGINT', 'BIGINT']);
            const bytes = file.size - sample.format.dataOffset;
            const source = {
                file,
                names: sample.names,
                plan: () => sample.plan(),
                planParts: () => [0, 1, 2, 3].map(index => ({
                    index,
                    start: sample.format.dataOffset + Math.floor(bytes * index / 4),
                    end: index === 3 ? null : sample.format.dataOffset + Math.floor(bytes * (index + 1) / 4),
                    inQuotes: false,
                })),
            };
            const conversion = await convertCsv(source, sniffer.module, { runner: inThreadRunner });
            // Only the part with the value widens, once
            const widened = conversion.parts.filter(p => p.types[1] === 'DOUBLE PRECISION');
            expect(widened).toHaveLength(1);
            expect(widened[0].reruns).toBe(1);
            expect(conversion.parts.filter(p => p.types[1] === 'BIGINT').map(p => p.reruns)).toEqual([0, 0, 0]);
            const rows = await readParts(conversion);
            expect(rows).toHaveLength(800);
            expect(rows[400].score).toBe(4.5);
            expect(rows[399].score).toBe(399 % 7);
        } finally {
            sample.release();
        }
    });

    it('samples windows after the first MiB', async () => {
        const lines = ['id,code\n'];
        for (let i = 0; i < 200_000; ++i) lines.push(`${i},${i === 150_000 ? 'x' : i % 10}\n`);
        const file = new Blob(lines);
        expect(file.size).toBeGreaterThan(1.5 * 1024 * 1024);
        const sample = await sniffer.sample(file);
        try {
            // The first MiB has only numbers, a window after it finds the text
            expect(sample.schema.sampled).toBe(true);
            expect(sample.schema.columns.map(c => c.type)).toEqual(['BIGINT', 'TEXT']);
        } finally {
            sample.release();
        }
    });
});
