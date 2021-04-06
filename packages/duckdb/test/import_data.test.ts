import * as duckdb from '../src';

const encoder = new TextEncoder();

export function testImportData(db: () => duckdb.AsyncDuckDB, tmp_file: (buf: Uint8Array) => string, basedir: string) {
    let conn: duckdb.AsyncDuckDBConnection;

    beforeEach(async () => {
        conn = await db().connect();
    });

    afterEach(async () => {
        await conn.disconnect();
    });

    describe('CSV', () => {
        it('SimpleColumns', async () => {
            const file = tmp_file(encoder.encode('1,2,3\n4,5,4\n7,8,9'));
            await expectAsync(conn.importCSV(file, 'test_schema', 'test_table')).toBeResolvedTo(null);
        });
    });

    describe('Parquet', () => {
        it('Uni Schema', async () => {
            await expectAsync(
                conn.importParquet(`${basedir}/studenten.parquet`, 'test_schema', 'test_table2'),
            ).toBeResolvedTo(null);
        });
    });

    describe('JSON', () => {
        it('Basic', async () => {
            let data = [
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
            ];
            let json = JSON.stringify(data);

            await expectAsync(conn.importJSON(json, 'json_schema', 'json_table')).toBeResolvedTo(null);
            let result = await conn.sendQuery('SELECT MatrNr, Titel FROM json_schema.json_table');
            expect(result.columnTypesLength()).toBe(2);
            let chunks = new duckdb.AsyncChunkStreamIterator(conn, result);
            interface Row extends duckdb.RowProxy {
                matrnr: number | null;
                titel: string | null;
            }
            let vals: object[] = [];
            while (await chunks.nextAsync()) {
                for (let row of chunks.collect<Row>()) {
                    vals.push({
                        MatrNr: row.matrnr,
                        Titel: row.titel,
                    });
                }
            }

            expect(vals).toEqual(data);
        });

        it('Nulls', async () => {
            let data = [
                { MatrNr: 26120, Titel: null },
                { MatrNr: null, Titel: 'Grundzüge' },
                { MatrNr: 27550, Titel: 'Logik' },
                { MatrNr: null, Titel: null },
                { MatrNr: 25403, Titel: 'Glaube und Wissen' },
            ];
            let json = JSON.stringify(data);

            await expectAsync(conn.importJSON(json, 'json_schema', 'json_table2')).toBeResolvedTo(null);

            let result = await conn.sendQuery('SELECT matrnr, titel FROM json_schema.json_table2');
            expect(result.columnTypesLength()).toBe(2);
            let chunks = new duckdb.AsyncChunkStreamIterator(conn, result);
            interface Row extends duckdb.RowProxy {
                matrnr: number | null;
                titel: string | null;
            }
            let vals: object[] = [];
            while (await chunks.nextAsync()) {
                for (let row of chunks.collect<Row>()) {
                    vals.push({
                        MatrNr: row.matrnr,
                        Titel: row.titel,
                    });
                }
            }

            expect(vals).toEqual(data);
        });

        it('Mixed Types', async () => {
            let data = [
                { MatrNr: 26120, Titel: null },
                { MatrNr: 'Text', Titel: 'Grundzüge' },
                { MatrNr: 27550, Titel: 'Logik' },
                { MatrNr: null, Titel: null },
                { MatrNr: 25403, Titel: 'Glaube und Wissen' },
            ];
            let json = JSON.stringify(data);

            await expectAsync(conn.importJSON(json, 'json_schema', 'json_table2')).toBeRejected();
        });
    });
}
