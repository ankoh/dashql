import * as webdb from '../../src/targets/async_node';
import * as path from 'path';

let worker: Worker;
let db: webdb.AsyncWebDB;
var conn: webdb.AsyncWebDBConnection;
const logger = new webdb.ConsoleLogger();
const testRows = 3000;

describe('foo', () => {
    beforeAll(async () => {
        console.log('foo');
        console.log('./dist/webdb-node-async.worker.cjs');
        worker = new webdb.Worker(new URL('./dist/webdb-node-async.worker.cjs'));
        worker.onerror = e => console.error(e);
        worker.onmessage = e => console.error(e);
        console.log('ok');
        console.log(path.resolve(__dirname, '../dist/webdb-node-async.worker.cjs'));
        db = new webdb.AsyncWebDB(logger, worker);
        await db.open(path.resolve(__dirname, '../dist/webdb.wasm'));
    });

    afterAll(async () => {
        console.log('bar');
        await db.terminate();
    });

    beforeEach(async () => {
        conn = await db.connect();
    });

    afterEach(async () => {
        await conn.disconnect();
    });

    describe('AsyncWebDB', () => {
        it('ping', async () => {
            await db.ping();
        });
    });

    //describe('AsyncWebDB', () => {
    //    it('blob stream', async () => {
    //        await db.ingestBlobStream(NodeBlobStream.fromFile('./data/blob.txt'));
    //    });
    //});

    describe('QueryResultRowIterator', () => {
        describe('single column', () => {
            it('TINYINT', async () => {
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

        //    describe('uni-schema from parquet', () => {
        //        it('single table', async () => {
        //            let result = await conn.sendQuery(`
        //                SELECT MatrNr FROM parquet_scan('./data/studenten.parquet');
        //            `);
        //            expect(result.columnTypesLength()).toBe(1);
        //            let chunks = new webdb.ChunkStreamIterator(conn, result);
        //            let vals: number[] = [];
        //            while (await chunks.nextAsync()) {
        //                for (const v of chunks.iterateNumberColumn(0)) {
        //                    vals.push(v!);
        //                }
        //            }
        //            expect(vals).toStrictEqual([24002, 25403, 26120, 26830, 27550, 28106, 29120, 29555]);
        //        });
        //        it('simple join', async () => {
        //            let result = await conn.sendQuery(`
        //                SELECT studenten.MatrNr, vorlesungen.Titel
        //                FROM parquet_scan('./data/studenten.parquet') studenten
        //                INNER JOIN parquet_scan('./data/hoeren.parquet') hoeren ON (studenten.MatrNr = hoeren.MatrNr)
        //                INNER JOIN parquet_scan('./data/vorlesungen.parquet') vorlesungen ON (vorlesungen.VorlNr = hoeren.VorlNr);
        //            `);
        //            expect(result.columnTypesLength()).toBe(2);
        //            let chunks = new webdb.ChunkStreamIterator(conn, result);
        //            interface Row extends webdb.RowProxy {
        //                MatrNr: number | null;
        //                Titel: string | null;
        //            }
        //
        //            let vals: object[] = [];
        //            while (await chunks.nextAsync()) {
        //                for (let row of chunks.collect<Row>()) {
        //                    vals.push({
        //                        MatrNr: row.MatrNr,
        //                        Titel: row.Titel,
        //                    });
        //                }
        //            }
        //
        //            expect(vals).toStrictEqual([
        //                { MatrNr: 26120, Titel: 'Grundzüge' },
        //                { MatrNr: 27550, Titel: 'Grundzüge' },
        //                { MatrNr: 27550, Titel: 'Logik' },
        //                { MatrNr: 28106, Titel: 'Ethik' },
        //                { MatrNr: 28106, Titel: 'Wissenschaftstheorie' },
        //                { MatrNr: 28106, Titel: 'Bioethik' },
        //                { MatrNr: 28106, Titel: 'Der Wieer Kreis' },
        //                { MatrNr: 29120, Titel: 'Grundzüge' },
        //                { MatrNr: 29120, Titel: 'Ethik' },
        //                { MatrNr: 29120, Titel: 'Mäeutik' },
        //                { MatrNr: 29555, Titel: 'Glaube und Wissen' },
        //                { MatrNr: 25403, Titel: 'Glaube und Wissen' },
        //            ]);
        //        });
        //    });
    });
});
