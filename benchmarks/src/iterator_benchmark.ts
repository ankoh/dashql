import * as webdb from '@dashql/webdb';
import * as core from '@dashql/core';
import * as benny from 'benny';
import kleur from 'kleur';

import wasmPath from '@dashql/webdb/dist/webdb.wasm';

const noop = () => {};

function main(db: webdb.WebDB) {
    let tupleCount = 1000000;
    let bytes = 0;

    benny.suite(
        `Chunks | 1 column | 1m rows | materialized`,
        benny.add('BOOLEAN', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v > 0 FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateBooleanColumn(0, (_row: number, _v: boolean | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 1;
        }),

        benny.add('TINYINT', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 1;
        }),

        benny.add('SMALLINT', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 2;
        }),

        benny.add('INTEGER', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::INTEGER FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 4;
        }),

        benny.add('BIGINT', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::BIGINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateBigIntColumn(0, (_row: number, _v: bigint | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 8;
        }),

        benny.add('HUGEINT', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::HUGEINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateHugeIntColumn(0, (_row: number, _v: bigint | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 16;
        }),

        benny.add('FLOAT', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::FLOAT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 4;
        }),

        benny.add('DOUBLE', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::DOUBLE FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 8;
        }),

        benny.add('STRING', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::VARCHAR FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);

            bytes = 0;

            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateStringColumn(0, (_row: number, v: string | null) => {
                    bytes += v!.length;
                });
            }
            conn.disconnect();
        }),

        benny.cycle((result: any, _summary: any) => {
            let duration = result.details.median;
            let tupleThroughput = tupleCount / duration;
            let dataThroughput = bytes / duration;
            console.log(
                `${kleur.cyan(result.name)} t: ${duration.toFixed(3)} s ttp: ${core.utils.formatThousands(
                    tupleThroughput,
                )}/s dtp: ${core.utils.formatBytes(dataThroughput)}/s`,
            );
        }),
    );

    benny.suite(
        `Chunks | 1 column | 1m rows | materialized | measuring only scanning`,
        benny.add('BOOLEAN', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v > 0 FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            bytes = tupleCount * 1;
            conn.disconnect();
            return () => {
                let chunks = new webdb.ChunkArrayIterator(result);
                while (true) {
                    if (!chunks.nextBlocking()) break;
                    chunks.iterateBooleanColumn(0, (_row: number, _v: boolean | null) => {
                        noop();
                    });
                }
            };
        }),

        benny.add('TINYINT', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            bytes = tupleCount * 1;
            conn.disconnect();
            return () => {
                let chunks = new webdb.ChunkArrayIterator(result);
                while (true) {
                    if (!chunks.nextBlocking()) break;
                    chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                        noop();
                    });
                }
            };
        }),

        benny.add('SMALLINT', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            bytes = tupleCount * 2;
            conn.disconnect();
            return () => {
                let chunks = new webdb.ChunkArrayIterator(result);
                while (true) {
                    if (!chunks.nextBlocking()) break;
                    chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                        noop();
                    });
                }
            };
        }),

        benny.add('INTEGER', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::INTEGER FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            bytes = tupleCount * 4;
            conn.disconnect();
            return () => {
                let chunks = new webdb.ChunkArrayIterator(result);
                while (true) {
                    if (!chunks.nextBlocking()) break;
                    chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                        noop();
                    });
                }
            };
        }),

        benny.add('BIGINT', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::BIGINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            bytes = tupleCount * 8;
            conn.disconnect();
            return () => {
                let chunks = new webdb.ChunkArrayIterator(result);
                while (true) {
                    if (!chunks.nextBlocking()) break;
                    chunks.iterateBigIntColumn(0, (_row: number, _v: bigint | null) => {
                        noop();
                    });
                }
            };
        }),

        benny.add('HUGEINT', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::HUGEINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            bytes = tupleCount * 16;
            conn.disconnect();
            return () => {
                let chunks = new webdb.ChunkArrayIterator(result);
                while (true) {
                    if (!chunks.nextBlocking()) break;
                    chunks.iterateHugeIntColumn(0, (_row: number, _v: bigint | null) => {
                        noop();
                    });
                }
            };
        }),

        benny.add('FLOAT', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::FLOAT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            bytes = tupleCount * 4;
            conn.disconnect();
            return () => {
                let chunks = new webdb.ChunkArrayIterator(result);
                while (true) {
                    if (!chunks.nextBlocking()) break;
                    chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                        noop();
                    });
                }
            };
        }),

        benny.add('DOUBLE', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::DOUBLE FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            bytes = tupleCount * 8;
            conn.disconnect();
            return () => {
                let chunks = new webdb.ChunkArrayIterator(result);
                while (true) {
                    if (!chunks.nextBlocking()) break;
                    chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                        noop();
                    });
                }
            };
        }),

        benny.add('STRING', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::VARCHAR FROM generate_series(0, ${tupleCount}) as t(v);
            `);

            conn.disconnect();
            return () => {
                bytes = 0;
                let chunks = new webdb.ChunkArrayIterator(result);

                while (true) {
                    if (!chunks.nextBlocking()) break;
                    chunks.iterateStringColumn(0, (_row: number, v: string | null) => {
                        bytes += v!.length;
                    });
                }
            };
        }),

        benny.cycle((result: any, _summary: any) => {
            let duration = result.details.median;
            let tupleThroughput = tupleCount / duration;
            let dataThroughput = bytes / duration;
            console.log(
                `${kleur.cyan(result.name)} t: ${duration.toFixed(3)} s ttp: ${core.utils.formatThousands(
                    tupleThroughput,
                )}/s dtp: ${core.utils.formatBytes(dataThroughput)}/s`,
            );
        }),
    );

    benny.suite(
        `Chunks | 1 column | 1m rows | streaming`,
        benny.add('BOOLEAN', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT v > 0 FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateBooleanColumn(0, (_row: number, _v: boolean | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 8;
        }),

        benny.add('TINYINT', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 8;
        }),

        benny.add('SMALLINT', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 8;
        }),

        benny.add('INTEGER', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT v::INTEGER FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 8;
        }),

        benny.add('BIGINT', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT v::BIGINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateBigIntColumn(0, (_row: number, _v: bigint | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 8;
        }),

        benny.add('HUGEINT', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT v::HUGEINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateHugeIntColumn(0, (_row: number, _v: bigint | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 16;
        }),

        benny.add('FLOAT', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT v::FLOAT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 8;
        }),

        benny.add('DOUBLE', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT v::DOUBLE FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();

            bytes = tupleCount * 8;
        }),

        benny.add('STRING', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT v::VARCHAR FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            bytes = 0;

            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateStringColumn(0, (_row: number, v: string | null) => {
                    bytes += v!.length;
                });
            }
            conn.disconnect();
        }),

        benny.cycle((result: any, _summary: any) => {
            let duration = result.details.median;
            let tupleThroughput = tupleCount / duration;
            let dataThroughput = bytes / duration;
            console.log(
                `${kleur.cyan(result.name)} t: ${duration.toFixed(3)} s ttp: ${core.utils.formatThousands(
                    tupleThroughput,
                )}/s dtp: ${core.utils.formatBytes(dataThroughput)}/s`,
            );
        }),
    );
}

const logger = new webdb.VoidLogger();
const db = new webdb.WebDB(logger, webdb.DefaultWebDBRuntime, wasmPath);
db.open()
    .then(() => main(db))
    .catch(e => console.error(e));
