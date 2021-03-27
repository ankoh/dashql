import Worker from 'web-worker';
import * as webdb from '@dashql/webdb/dist/webdb-node-parallel.js';
import * as fg from 'fast-glob';
import parse from 'csv-parse/lib/sync';
import * as parquet from 'parquetjs';

import * as fs from 'fs';
import path from 'path';
const workerPath = path.resolve(__dirname, '../../webdb/dist/webdb-node-parallel.worker.js');
const wasmPath = path.resolve(__dirname, '../../webdb/dist/webdb.wasm');
const dbPath = '/home/dakror/Desktop/2.18.0_rc2/ref_data/1';

async function main(db: webdb.AsyncWebDB) {
    let conn = await db.connect();
    // assemble parquets
    var lineitemSchema = new parquet.ParquetSchema({
        l_orderkey: { type: 'INT64' },
        l_partkey: { type: 'INT64' },
        l_suppkey: { type: 'INT64' },
        l_linenumber: { type: 'INT64' },
        l_quantity: { type: 'DOUBLE' },
        l_extendedprice: { type: 'DOUBLE' },
        l_discount: { type: 'DOUBLE' },
        l_tax: { type: 'DOUBLE' },
        l_returnflag: { type: 'UTF8' },
        l_linestatus: { type: 'UTF8' },
        l_shipdate: { type: 'TIMESTAMP_MILLIS' },
        l_commitdate: { type: 'TIMESTAMP_MILLIS' },
        l_receiptdate: { type: 'TIMESTAMP_MILLIS' },
        l_shipinstruct: { type: 'UTF8' },
        l_shipmode: { type: 'UTF8' },
        l_comment: { type: 'UTF8' },
    });
    let lineitemPath = path.resolve(__dirname, 'lineitem.parquet');
    let lineitemWriter = await parquet.ParquetWriter.openFile(lineitemSchema, lineitemPath);

    let c = 0;
    for (let file of fg.sync(`${dbPath}/lineitem.tbl.[0-9]*`)) {
        for (let row of parse(fs.readFileSync(file), {
            delimiter: '|',
        })) {
            if (c++ > 4) break;
            console.log(row);
            await lineitemWriter.appendRow({
                l_orderkey: parseInt(row[0]),
                l_partkey: parseInt(row[1]),
                l_suppkey: parseInt(row[2]),
                l_linenumber: parseInt(row[3]),
                l_quantity: parseFloat(row[4]),
                l_extendedprice: parseFloat(row[5]),
                l_discount: parseFloat(row[6]),
                l_tax: parseFloat(row[7]),
                l_returnflag: row[8],
                l_linestatus: row[9],
                l_shipdate: new Date(row[10]),
                l_commitdate: new Date(row[11]),
                l_receiptdate: new Date(row[12]),
                l_shipinstruct: row[13],
                l_shipmode: row[14],
                l_comment: row[15],
            });
        }
    }

    await lineitemWriter.close();

    db.registerURL(lineitemPath);

    let result = await conn.runQuery(
        `select l_orderkey,l_shipdate
        from parquet_scan('${lineitemPath}') lineitem LIMIT 5`,
    );

    const chunks = new webdb.StaticChunkIterator(result);
    interface Row extends webdb.RowProxy {
        l_orderkey: bigint;
        // l_partkey: number;
        // l_suppkey: number;
        // l_linenumber: number;
        // l_quantity: number;
        // l_extendedprice: number;
        // l_discount: number;
        // l_tax: number;
        // l_returnflag: string;
        // l_linestatus: string;
        l_shipdate: Date;
        // l_commitdate: Date;
        // l_receiptdate: Date;
        // l_shipinstruct: string;
        // l_shipmode: string;
        // l_comment: string;
    }

    //     while (chunks.nextBlocking()) {
    //         for (let x of chunks.iterateBigIntColumn(0)) {
    //             console.log(x);
    //         }
    //         for (let x of chunks.iterateDateColumn(1)) {
    //             console.log(x);
    //         }
    //     }
    //
    //     chunks.rewind();

    const rows = chunks.collectAllBlocking<Row>();
    console.log(
        rows.map((row: Row) => {
            let o = {};
            rows.columns.forEach((x: string) => {
                o[x] = row[x];
            });
            return o;
        }),
    );
}

const logger = new webdb.VoidLogger();
const worker = new Worker(workerPath);
const db = new webdb.AsyncWebDB(logger, worker);
db.open(wasmPath)
    .then(() => main(db))
    .then(() => db.terminate())
    .catch(e => console.error(e));
