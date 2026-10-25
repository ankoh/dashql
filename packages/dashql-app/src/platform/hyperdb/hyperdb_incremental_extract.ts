import type * as arrow from 'apache-arrow';

import type {
    EmbeddedClientContext,
    EmbeddedComputeDatabase,
    EmbeddedConnection,
    EmbeddedTableImportConnection,
} from '../database/embedded_database.js';
import { quoteIdentifier } from './hyperdb_wasm.js';

/// A column of a query result or table.
export interface HyperDBExtractColumn {
    /// The column name
    name: string;
    /// The SQL type of the column
    type: string;
}

/// A table of the extract, filled by a query over the new source rows.
export interface HyperDBExtractTable {
    /// The table name in the schema of the extract
    name: string;
    /// A query over the relation of the source (e.g. `log`) that holds the new source rows.
    /// The columns of its result are the columns of the table, cast in the query to choose their types.
    query: string;
    /// The maximum number of rows that the table keeps, the rows with the lowest row numbers are deleted first
    maxRows?: number;
    /// The time in milliseconds that the table reaches back from its newest row, by the watermark column.
    /// Older rows are deleted, the table must have the watermark column.
    maxAgeMs?: number;
}

/// The column with the row numbers of every extract table, in insertion order and by the watermark within a transfer.
export const HYPER_EXTRACT_ROW_COLUMN = '__row';

/// A connection to the Hyper that an extract reads, e.g. an embedded connection or a channel to a remote Hyper
export type HyperDBSourceConnection = Pick<EmbeddedConnection, 'query' | 'execute' | 'close'>;

/// The Hyper that an extract reads
export interface HyperDBSourceDatabase {
    /// Connect to the Hyper, the client context describes the queries of the connection
    connect(options?: { clientContext?: EmbeddedClientContext }): Promise<HyperDBSourceConnection>;
}

/// The rows that an incremental extract reads from a source Hyper.
///
/// The rows are identified by all of their columns, and the newest extracted value of the watermark column bounds the
/// backfills. Without an update query, every poll is a backfill from the watermark.
export interface HyperDBIncrementalExtractSource {
    /// The name of the relation with the new source rows in the table queries
    relation: string;
    /// The columns of the source rows, the source queries return exactly these
    columns: readonly HyperDBExtractColumn[];
    /// The timestamp column whose newest extracted value is the watermark of backfills
    watermarkColumn: string;
    /// Check the source on the first source connection, before the first query
    open?(connection: HyperDBSourceConnection): Promise<void>;
    /// The query of the source rows that satisfy the watermark predicate, or of all rows when it is null
    backfillQuery(since: string | null): string;
    /// The query of the source rows since the connection that runs it was connected, cheaper than a backfill.
    /// E.g. the scope of the Hyper log of a session, which starts with the session.
    updateQuery?(): string;
}

/// Options of an incremental extract.
export interface HyperDBIncrementalExtractOptions {
    /// The Hyper that is read
    sourceDatabase: HyperDBSourceDatabase;
    /// The rows that are read
    source: HyperDBIncrementalExtractSource;
    /// The Hyper that holds the extract
    sink: EmbeddedComputeDatabase;
    /// The path of an extract file in the sink, e.g. /mnt/fs/hyper_log.hyper.
    /// Without it, the extract lives in the compute database of the sink, where its compute connections read it.
    databasePath?: string;
    /// The alias of the extract file on the sink connection, readers that attach the file with this alias resolve
    /// the names of tableName(). hyper_extract when not set.
    databaseAlias?: string;
    /// The schema of the extract tables, public when not set
    schema?: string;
    /// The tables of the extract
    tables: readonly HyperDBExtractTable[];
    /// The client context of the source and sink connections, e.g. to attribute their queries in the Hyper log
    clientContext?: EmbeddedClientContext;
    /// The polling interval of start() in milliseconds
    intervalMs?: number;
    /// How far before the watermark a backfill reads again, in milliseconds
    backfillOverlapMs?: number;
    /// Receives the transfers of polls started by the timer
    onTransfer?: (transfer: HyperDBExtractTransfer) => void;
    /// Receives the errors of polls started by the timer
    onError?: (error: unknown) => void;
}

/// The row counts of one transfer from the source into the extract.
export interface HyperDBExtractTransfer {
    /// The rows read from the source
    fetched: number;
    /// The rows that were new to the extract
    appended: number;
    /// The rows appended to every extract table
    tables: Record<string, number>;
    /// The rows deleted from every extract table with a row limit
    deleted: Record<string, number>;
}

/// The default alias of an extract file on the sink connection.
const EXTRACT_ALIAS = 'hyper_extract';
/// The default database of sink connections, it holds the staging tables of transfers.
const SINK_DEFAULT_DATABASE = '__dashql_compute';

/// The qualified names of the tables of an extract
class ExtractNames {
    /// The table with the recently extracted rows, the newest watermark value is the watermark of backfills.
    /// It keeps the rows of the backfill overlap, which suffices to skip rows that are read twice.
    readonly recentRows: string;
    /// The table with the new rows of the running transfer, the relation of the table queries.
    readonly newRows: string;

    constructor(
        /// The qualified schema of the extract tables
        readonly schema: string,
    ) {
        this.recentRows = this.table('__recent_rows');
        this.newRows = this.table('__new_rows');
    }

    /// The qualified name of a table of the extract
    table(name: string): string {
        return `${this.schema}.${quoteIdentifier(name)}`;
    }
}

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_BACKFILL_OVERLAP_MS = 10_000;

/// Incrementally copies rows of one Hyper (the source) into the tables of an extract file in another Hyper (the sink).
///
/// Every poll reads the new source rows, with the update query of the source or else with a backfill from the
/// watermark. The rows travel as Arrow to the sink, where every extract table receives the rows of its query over the
/// new rows. open() always backfills from the watermark, so that the rows since the last extraction survive a
/// disconnect. Backfills read again from a short overlap before the watermark: the sink skips the rows that it
/// extracted before, comparing all columns. A transfer fills all extract tables in one transaction.
///
/// An update query reads the rows since its connection was connected. Every poll connects the next reader before the
/// current reader reads, and then replaces it: the rows of consecutive polls overlap and none fall between them, also
/// not the rows of the read itself. The sink skips the rows of the overlap.
///
/// open() checks the queries with `EXPLAIN (FORMAT SCHEMA)` before it reads any rows. The schema of every extract
/// table is the result schema of its query, and an existing table must still match it. Every extract table also has
/// the row number column `__row`, which its row limit deletes by.
///
/// The extract is either a file that the sink attaches, or a schema of the compute database of the sink.
///
/// Limits of this proof of concept:
/// - Source rows older than the overlap before the watermark are never read again.
/// - An extract holds the rows of one source, and the source and the tables should stay the same across runs.
export class HyperDBIncrementalExtract {
    /// The pending timer of start(), null when not polling periodically
    private timer: ReturnType<typeof setTimeout> | null = null;
    /// The last poll, polls run one after another
    private polling: Promise<unknown> = Promise.resolve();
    /// Set by stop(), polls are rejected afterwards
    private stopped = false;

    private constructor(
        /// The connection to the source Hyper, the reader of the next poll
        private reader: HyperDBSourceConnection,
        /// The sink connection with the attached extract database
        private readonly sink: EmbeddedConnection,
        /// The sink connection that stages transfers, Arrow inserts need a connection with a single database
        private readonly stager: EmbeddedTableImportConnection,
        /// The name of the staging table of transfers in the sink
        private readonly stagingTable: string,
        /// The options of the extract
        private readonly options: HyperDBIncrementalExtractOptions,
        /// The qualified names of the extract tables
        private readonly names: ExtractNames,
        /// The columns of every extract table, by table name
        readonly schemas: Readonly<Record<string, readonly HyperDBExtractColumn[]>>,
        /// The transfer of the backfill in open()
        readonly backfill: HyperDBExtractTransfer,
    ) {}

    /// Open the extract, creating its tables when missing, and backfill since the watermark.
    static async open(options: HyperDBIncrementalExtractOptions): Promise<HyperDBIncrementalExtract> {
        const { source, clientContext } = options;
        let sink: EmbeddedConnection | null = null;
        let stager: EmbeddedTableImportConnection | null = null;
        let reader: HyperDBSourceConnection | null = null;
        try {
            // Open the source first, a source that cannot be read leaves no extract file behind
            reader = await options.sourceDatabase.connect({ clientContext });
            await source.open?.(reader);
            sink = await options.sink.connect({ defaultDatabase: SINK_DEFAULT_DATABASE, clientContext });
            stager = await options.sink.connect({ defaultDatabase: SINK_DEFAULT_DATABASE, clientContext });
            const database = options.databasePath == null ? SINK_DEFAULT_DATABASE : options.databaseAlias ?? EXTRACT_ALIAS;
            if (options.databasePath != null) {
                const path = quoteIdentifier(options.databasePath);
                await sink.execute(`CREATE DATABASE IF NOT EXISTS ${path}`);
                await sink.execute(`ATTACH DATABASE ${path} AS ${quoteIdentifier(database)}`);
            }
            const names = new ExtractNames(`${quoteIdentifier(database)}.${quoteIdentifier(options.schema ?? 'public')}`);
            if (options.schema != null) await sink.execute(`CREATE SCHEMA IF NOT EXISTS ${names.schema}`);
            await sink.execute(`CREATE TABLE IF NOT EXISTS ${names.recentRows} (${columnDefinitions(source.columns)})`);
            await sink.execute(`CREATE TABLE IF NOT EXISTS ${names.newRows} (${columnDefinitions(source.columns)})`);
            const schemas = await prepareTables(sink, source, names, options.tables);

            await checkSourceQuery(reader, source, source.backfillQuery(null));
            const updateQuery = source.updateQuery?.();
            if (updateQuery != null) await checkSourceQuery(reader, source, updateQuery);

            // The first update reads the rows since the reader connected again, the sink skips them
            const stagingTable = `__hyper_extract_staging_${crypto.randomUUID().replace(/-/g, '_')}`;
            const rows = await reader.query(await backfillQuery(sink, names, options));
            const backfill = await transfer(sink, stager, stagingTable, options, names, schemas, rows);
            return new HyperDBIncrementalExtract(reader, sink, stager, stagingTable, options, names, schemas, backfill);
        } catch (error) {
            // Close every connection and keep the error that failed the open.
            for (const connection of [reader, stager, sink]) {
                await connection?.close().catch(() => {});
            }
            throw error;
        }
    }

    /// The qualified name of an extract table, e.g. to read it on a connection of the sink
    tableName(name: string): string {
        return this.names.table(name);
    }

    /// Transfer the source rows since the last poll into the extract.
    poll(): Promise<HyperDBExtractTransfer> {
        const poll = this.polling.catch(() => {}).then(async () => {
            if (this.stopped) throw new Error('extract is stopped');
            const { source, sourceDatabase, clientContext } = this.options;
            const updateQuery = source.updateQuery?.();
            if (updateQuery == null) {
                const rows = await this.reader.query(await backfillQuery(this.sink, this.names, this.options));
                return await transfer(this.sink, this.stager, this.stagingTable, this.options, this.names, this.schemas, rows);
            }
            // The next reader starts before the read, it replaces the current reader once the rows are transferred.
            // A failed poll keeps the current reader, the next poll reads its rows again.
            const next = await sourceDatabase.connect({ clientContext });
            try {
                const rows = await this.reader.query(projectSourceQuery(source, updateQuery));
                const transferred = await transfer(this.sink, this.stager, this.stagingTable, this.options, this.names, this.schemas, rows);
                const previous = this.reader;
                this.reader = next;
                await previous.close().catch(() => {});
                return transferred;
            } catch (error) {
                await next.close().catch(() => {});
                throw error;
            }
        });
        this.polling = poll;
        return poll;
    }

    /// Poll every intervalMs until stop().
    start(): void {
        if (this.stopped || this.timer != null) return;
        const schedule = () => {
            this.timer = setTimeout(() => {
                // A transfer that committed is reported, also when the extract stopped meanwhile
                void this.poll().then(transfer => {
                    this.options.onTransfer?.(transfer);
                }, error => {
                    if (!this.stopped) this.options.onError?.(error);
                }).finally(() => {
                    if (!this.stopped) schedule();
                });
            }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
        };
        schedule();
    }

    /// Stop polling, wait for a running poll and close all connections. The extract file is kept.
    async stop(): Promise<void> {
        if (this.stopped) return;
        this.stopped = true;
        if (this.timer != null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        await this.polling.catch(() => {});
        try {
            await this.reader.close();
            await this.stager.close();
            if (this.options.databasePath != null) {
                await this.sink.execute(`DETACH DATABASE ${quoteIdentifier(this.options.databaseAlias ?? EXTRACT_ALIAS)}`);
            }
        } finally {
            await this.sink.close();
        }
    }
}

/// The backfill query from the overlap before the watermark, or of all rows for an empty extract.
async function backfillQuery(sink: EmbeddedConnection, names: ExtractNames, options: HyperDBIncrementalExtractOptions): Promise<string> {
    const { source } = options;
    const column = quoteIdentifier(source.watermarkColumn);
    const type = source.columns.find(({ name }) => name === source.watermarkColumn)?.type;
    if (type == null) throw new Error(`the watermark column ${source.watermarkColumn} is not a source column`);
    const result = await sink.query(`SELECT max(${column})::text AS watermark FROM ${names.recentRows}`);
    const watermark = result.getChild('watermark')?.get(0);
    const since = typeof watermark === 'string'
        ? `${column} >= ${quoteLiteral(watermark)}::${type} - ${overlapInterval(options)}`
        : null;
    return projectSourceQuery(source, source.backfillQuery(since));
}

/// A source query with its columns cast to the source columns.
function projectSourceQuery(source: HyperDBIncrementalExtractSource, query: string): string {
    return `WITH selected AS (${query}) SELECT ${castColumns(source.columns)} FROM selected`;
}

/// A table query over the relation of the source with the new rows of a transfer.
function tableQuery(source: HyperDBIncrementalExtractSource, names: ExtractNames, table: HyperDBExtractTable): string {
    return `
        WITH ${quoteIdentifier(source.relation)} AS (SELECT * FROM ${names.newRows}), selected AS (${table.query})
        SELECT * FROM selected
    `;
}

/// Check that a source query returns exactly the source columns.
async function checkSourceQuery(
    connection: HyperDBSourceConnection,
    source: HyperDBIncrementalExtractSource,
    query: string,
): Promise<void> {
    const columns = await describeQuery(connection, query, 'source query');
    const names = new Set(columns.map(({ name }) => name));
    const missing = source.columns.filter(({ name }) => !names.has(name)).map(({ name }) => name);
    const unexpected = [...names].filter(name => !source.columns.some(column => column.name === name));
    if (missing.length > 0 || unexpected.length > 0) {
        throw new Error(`the source query must return the source columns: ${[
            missing.length > 0 ? `missing ${missing.join(', ')}` : null,
            unexpected.length > 0 ? `unexpected ${unexpected.join(', ')}` : null,
        ].filter(part => part != null).join(', ')}`);
    }
}

/// Create the missing extract tables with the result schemas of their queries, and check the existing ones.
async function prepareTables(
    sink: EmbeddedConnection,
    source: HyperDBIncrementalExtractSource,
    names: ExtractNames,
    tables: readonly HyperDBExtractTable[],
): Promise<Record<string, readonly HyperDBExtractColumn[]>> {
    const schemas: Record<string, readonly HyperDBExtractColumn[]> = {};
    for (const table of tables) {
        if (table.name in schemas) throw new Error(`the extract table ${table.name} is configured twice`);
        if (table.name.startsWith('__')) throw new Error(`the extract table name ${table.name} is reserved`);
        if (table.maxRows != null && !(Number.isInteger(table.maxRows) && table.maxRows > 0)) {
            throw new Error(`the row limit of the extract table ${table.name} must be a positive integer`);
        }
        if (table.maxAgeMs != null && !(table.maxAgeMs > 0)) {
            throw new Error(`the age limit of the extract table ${table.name} must be positive`);
        }
        const columns = await describeQuery(sink, tableQuery(source, names, table), `query of the extract table ${table.name}`);
        const reserved = columns.find(({ name }) => name.startsWith('__'));
        if (reserved != null) throw new Error(`the column name ${reserved.name} of the extract table ${table.name} is reserved`);
        if (table.maxAgeMs != null && !columns.some(({ name }) => name === source.watermarkColumn)) {
            throw new Error(`the extract table ${table.name} needs the watermark column ${source.watermarkColumn} for its age limit`);
        }
        await sink.execute(`CREATE TABLE IF NOT EXISTS ${names.table(table.name)} (${
            columnDefinitions([{ name: HYPER_EXTRACT_ROW_COLUMN, type: 'BIGINT' }, ...columns])
        })`);
        const existing = await describeQuery(sink, `SELECT * FROM ${names.table(table.name)}`, `extract table ${table.name}`)
            .then(existing => existing.filter(({ name }) => name !== HYPER_EXTRACT_ROW_COLUMN));
        if (formatColumns(existing) !== formatColumns(columns)) {
            throw new Error(`the extract table ${table.name} has the columns (${formatColumns(existing)}), `
                + `but its query returns (${formatColumns(columns)})`);
        }
        schemas[table.name] = columns;
    }
    return schemas;
}

/// The result columns of a query, from `EXPLAIN (FORMAT SCHEMA)`.
async function describeQuery(connection: HyperDBSourceConnection, query: string, what: string): Promise<HyperDBExtractColumn[]> {
    let result: arrow.Table;
    try {
        result = await connection.query(`EXPLAIN (FORMAT SCHEMA) ${query}`);
    } catch (error) {
        throw new Error(`invalid ${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const names = result.getChild('name');
    const types = result.getChild('type');
    const columns: HyperDBExtractColumn[] = [];
    for (let i = 0; i < result.numRows; ++i) {
        const name = names?.get(i) as string;
        if (columns.some(column => column.name === name)) throw new Error(`the ${what} returns the column ${name} twice`);
        columns.push({ name, type: types?.get(i) as string });
    }
    if (columns.length === 0) throw new Error(`the ${what} returns no columns`);
    return columns;
}

/// Append the fetched rows that are new to the extract to all extract tables, in one transaction of the extract.
async function transfer(
    sink: EmbeddedConnection,
    stager: EmbeddedTableImportConnection,
    stagingTable: string,
    options: HyperDBIncrementalExtractOptions,
    names: ExtractNames,
    schemas: Readonly<Record<string, readonly HyperDBExtractColumn[]>>,
    rows: arrow.Table,
): Promise<HyperDBExtractTransfer> {
    const { source } = options;
    const tables = Object.fromEntries(options.tables.map(table => [table.name, 0]));
    const deleted = Object.fromEntries(options.tables
        .filter(table => table.maxRows != null || table.maxAgeMs != null)
        .map(table => [table.name, 0]));
    if (rows.numRows === 0) return { fetched: 0, appended: 0, tables, deleted };
    const staging = `${quoteIdentifier(SINK_DEFAULT_DATABASE)}.public.${quoteIdentifier(stagingTable)}`;
    const columns = columnList(source.columns);
    const watermark = quoteIdentifier(source.watermarkColumn);
    await stager.insertArrowTable(rows, { name: stagingTable, create: true });
    try {
        // A transaction may only modify one database and may not mix DDL with DML.
        await sink.execute('BEGIN');
        try {
            await sink.execute(`DELETE FROM ${names.newRows}`);
            const appended = await sink.execute(`
                INSERT INTO ${names.newRows} (${columns})
                SELECT DISTINCT ${source.columns.map(({ name }) => `s.${quoteIdentifier(name)}`).join(', ')}
                FROM ${staging} s
                WHERE NOT EXISTS (
                    SELECT 1 FROM ${names.recentRows} e
                    WHERE e.${watermark} = s.${watermark} AND ${source.columns.map(({ name }) =>
                        `e.${quoteIdentifier(name)} IS NOT DISTINCT FROM s.${quoteIdentifier(name)}`).join(' AND ')}
                )
            `);
            await sink.execute(`INSERT INTO ${names.recentRows} (${columns}) SELECT ${columns} FROM ${names.newRows}`);
            const row = quoteIdentifier(HYPER_EXTRACT_ROW_COLUMN);
            for (const table of options.tables) {
                const name = names.table(table.name);
                const order = schemas[table.name].some(({ name }) => name === source.watermarkColumn) ? `ORDER BY ${watermark}` : '';
                tables[table.name] = Number(await sink.execute(`
                    INSERT INTO ${name} (${row}, ${columnList(schemas[table.name])})
                    WITH ${quoteIdentifier(source.relation)} AS (SELECT * FROM ${names.newRows}), selected AS (${table.query})
                    SELECT (SELECT coalesce(max(${row}), 0) FROM ${name}) + row_number() OVER (${order}), *
                    FROM selected
                `) ?? 0);
                if (table.maxRows != null) {
                    deleted[table.name] += Number(await sink.execute(`
                        DELETE FROM ${name} WHERE ${row} <= (SELECT max(${row}) FROM ${name}) - ${table.maxRows}
                    `) ?? 0);
                }
                if (table.maxAgeMs != null) {
                    deleted[table.name] += Number(await sink.execute(`
                        DELETE FROM ${name} WHERE ${watermark} < (SELECT max(${watermark}) FROM ${name}) - ${interval(table.maxAgeMs)}
                    `) ?? 0);
                }
            }
            await sink.execute(`
                DELETE FROM ${names.recentRows}
                WHERE ${watermark} < (SELECT max(${watermark}) FROM ${names.recentRows}) - ${overlapInterval(options)}
            `);
            await sink.execute('COMMIT');
            return { fetched: rows.numRows, appended: Number(appended ?? 0), tables, deleted };
        } catch (error) {
            await sink.execute('ROLLBACK');
            throw error;
        }
    } finally {
        await stager.execute(`DROP TABLE ${quoteIdentifier(stagingTable)}`);
    }
}

function formatColumns(columns: readonly HyperDBExtractColumn[]): string {
    return columns.map(({ name, type }) => `${name} ${type.toLowerCase()}`).join(', ');
}

function interval(ms: number): string {
    return `interval '${ms / 1000} seconds'`;
}

function overlapInterval(options: HyperDBIncrementalExtractOptions): string {
    return interval(options.backfillOverlapMs ?? DEFAULT_BACKFILL_OVERLAP_MS);
}

function columnDefinitions(columns: readonly HyperDBExtractColumn[]): string {
    return columns.map(({ name, type }) => `${quoteIdentifier(name)} ${type}`).join(', ');
}

function columnList(columns: readonly HyperDBExtractColumn[]): string {
    return columns.map(({ name }) => quoteIdentifier(name)).join(', ');
}

function castColumns(columns: readonly HyperDBExtractColumn[]): string {
    return columns.map(({ name, type }) => `${quoteIdentifier(name)}::${type} AS ${quoteIdentifier(name)}`).join(', ');
}

export function quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
