import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect } from '@jest/globals';
import Worker from 'web-worker';
import * as webdb from '../src/index_async';
import * as path from 'path';
import { NodeBlobStream } from '../src/webdb_bindings_node';

let worker: Worker;
let db: webdb.AsyncWebDB;
var conn: webdb.AsyncWebDBConnection;
const logger = new webdb.ConsoleLogger();
const testRows = 3000;

beforeAll(async () => {
    worker = new Worker(path.resolve(__dirname, '../dist/webdb_node_async.worker.js'));
    db = new webdb.AsyncWebDB(logger, worker);
    await db.open(path.resolve(__dirname, '../src/webdb_wasm.wasm'));
});

afterAll(async () => {
    await db.terminate();
});

beforeEach(async () => {
    conn = await db.connect();
});

afterEach(async () => {
    await conn.disconnect();
});

describe('AsyncWebDB', () => {
    test('ping', async () => {
        await db.ping();
    });
});

describe('AsyncWebDB', () => {
    test('blob stream', async () => {
        await db.ingestBlobStream(NodeBlobStream.fromFile('./data/blob.txt'));
    });
});

describe('QueryResultRowIterator', () => {
    describe('single column', () => {
        test('TINYINT', async () => {
            let result = await conn.sendQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            let i = 0;
            while (await chunks.nextAsync()) {
                for (const v of chunks.iterateNumberColumn(0)) {
                    expect(v).toBe(i++ & 127);
                }
            }
            expect(i).toBe(testRows + 1);
        });
    });

    describe('uni-schema from parquet', () => {
        test('single table', async () => {
            let result = await conn.sendQuery(`
                SELECT MatrNr FROM parquet_scan('./data/studenten.parquet');
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            let vals: number[] = [];
            while (await chunks.nextAsync()) {
                for (const v of chunks.iterateNumberColumn(0)) {
                    vals.push(v!);
                }
            }
            expect(vals).toStrictEqual([24002, 25403, 26120, 26830, 27550, 28106, 29120, 29555]);
        });
        test('simple join', async () => {
            let result = await conn.sendQuery(`
                SELECT studenten.MatrNr, vorlesungen.Titel 
                FROM parquet_scan('./data/studenten.parquet') studenten
                INNER JOIN parquet_scan('./data/hoeren.parquet') hoeren ON (studenten.MatrNr = hoeren.MatrNr)
                INNER JOIN parquet_scan('./data/vorlesungen.parquet') vorlesungen ON (vorlesungen.VorlNr = hoeren.VorlNr);
            `);
            expect(result.columnTypesLength()).toBe(2);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            interface Row extends webdb.RowProxy {
                MatrNr: number | null;
                Titel: string | null;
            }

            let vals: object[] = [];
            while (await chunks.nextAsync()) {
                for (let row of chunks.collect<Row>()) {
                    vals.push({
                        MatrNr: row.MatrNr,
                        Titel: row.Titel,
                    });
                }
            }

            expect(vals).toStrictEqual([
                { MatrNr: 26120, Titel: 'Grundzüge' },
                { MatrNr: 27550, Titel: 'Grundzüge' },
                { MatrNr: 27550, Titel: 'Logik' },
                { MatrNr: 28106, Titel: 'Ethik' },
                { MatrNr: 28106, Titel: 'Wissenschaftstheorie' },
                { MatrNr: 28106, Titel: 'Bioethik' },
                { MatrNr: 28106, Titel: 'Der Wieer Kreis' },
                { MatrNr: 29120, Titel: 'Grundzüge' },
                { MatrNr: 29120, Titel: 'Ethik' },
                { MatrNr: 29120, Titel: 'Mäeutik' },
                { MatrNr: 29555, Titel: 'Glaube und Wissen' },
                { MatrNr: 25403, Titel: 'Glaube und Wissen' },
            ]);
        });
    });
});
