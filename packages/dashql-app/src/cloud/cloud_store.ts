import { DASHQL_VERSION } from '../globals.js';
import { exportArrowTableAsParquet } from '../platform/hyperdb/hyperdb_parquet_export.js';
import { prepareHyperArrowInsert } from '../platform/hyperdb/hyperdb_arrow_insert.js';
import { WORKBOOK_FORMAT_VERSION } from '../storage/migration/versions.js';
import type { ParquetReadDatabase } from '../storage/workbook_tables_parquet.js';
import {
    ATTACHMENT_TABLE_PREFIX,
    ATTACHMENTS_TABLE,
    emptyWorkbookTables,
    isDataTableName,
    newDataTableName,
    RESULT_TABLE_PREFIX,
    RESULTS_TABLE,
    SCRIPTS_TABLE,
    WORKBOOK_TABLE,
    WORKBOOK_TABLE_COLUMNS,
    WORKBOOK_TABLE_NAMES,
    workbookTableFromArrow,
    type AttachmentRow,
    type WorkbookTableName,
    type WorkbookTables,
} from '../storage/workbook_tables.js';
import { createTableSQL, insertStatements, qualifiedName, quoteLiteral, type CloudColumn } from './cloud_sql.js';
import {
    checkCloudId,
    CLOUD_FOLDERS_TABLE,
    CLOUD_VERSIONS_TABLE,
    CLOUD_WORKBOOKS_TABLE,
    cloudTable,
    openCloudStore,
    type CloudQuery,
    type CloudStoreOptions,
} from './cloud_store_schema.js';

// The workbooks that DashQL keeps in the cloud connection. See docs/design/cloud.md.
//
// A workbook has a row in the workbooks table with its folder, which is written before its first version. Deleting a
// workbook only marks that row, the workbook and its versions are hidden then, and a cleanup removes them later.
//
// All tables live in the schema of DashQL. The versions table grows by one row per version of a published workbook and
// holds its workbook row. The other workbook tables are merged into one table each, keyed by workbook and version. Every
// attachment and every result is a table of its own, named by a row of the attachments or results table. A version row
// is written before anything of its version and removed after everything else, a data table is named by a row before
// it is created and dropped before its row is removed. Only the rows of ready versions are read. The current version of
// a workbook is the one that turned ready last, the earlier ones stay readable. Every operation opens the tables first,
// which creates and migrates them (cloud_store_schema.ts).

/// The workbook tables that are merged into one table of the cloud each, the workbook row goes into the versions table
export const CLOUD_MERGED_TABLE_NAMES: WorkbookTableName[] = WORKBOOK_TABLE_NAMES.filter(name => name !== WORKBOOK_TABLE);

/// The state of a version
export type CloudVersionState =
    /// The version is being written, or a publish failed without cleaning up
    | 'uploading'
    /// The version is complete and is read
    | 'ready'
    /// The version is being removed
    | 'deleting';

/// The key of a version, of its row and of its rows in the merged tables
export interface CloudVersionKey {
    /// The id of the workbook, the same for all its versions, a UUID
    workbookId: string;
    /// The id of the version, a UUID
    versionId: string;
}

/// A row of the versions table
export interface CloudWorkbookVersion extends CloudVersionKey {
    /// The position among the ready versions of the workbook in the order they turned ready, the first is 1.
    /// Only the listings number the versions, a version is named by its id.
    version: number;
    state: CloudVersionState;
    name: string | null;
    /// Who published the version, null if unknown
    publishedBy: string | null;
    /// The version of the app that published the version, null if unknown
    appVersion: string | null;
    /// The format version of the workbook. A version of a newer format than this client knows can't be read.
    formatVersion: number;
    /// Milliseconds since the epoch
    createdAt: number;
    /// Milliseconds since the epoch, when the version turned ready, null before
    readyAt: number | null;
    /// Milliseconds since the epoch, when the state last changed
    updatedAt: number;
}

/// A published workbook by its latest version
export interface CloudWorkbook extends CloudWorkbookVersion {
    /// The folder of the workbook as its row names it, null at the top. The workbooks of a folder that was deleted or
    /// doesn't exist show at the top (cloud_folders.ts).
    folderId: string | null;
}

export interface CloudPublishOptions extends CloudStoreOptions {
    /// The workbook that the publish adds a version to. Without one the publish starts a new workbook under a fresh id.
    workbookId?: string;
    /// The folder of a new workbook, the top without one. The folder of an existing workbook stays.
    folderId?: string;
    /// Who publishes, the login of the cloud connection
    publishedBy?: string;
    /// The version of the app that publishes, DASHQL_VERSION by default
    appVersion?: string;
    /// The most data that a publish sends, the text of the values of the attachments and results, 64 MiB by default
    maxDataBytes?: number;
}

/// The most data that a publish sends by default
export const DEFAULT_MAX_DATA_BYTES = 64 * 1024 * 1024;

/// The data of a publish is larger than the cloud takes
export class CloudPublishTooLargeError extends Error {
    constructor(limit: number) {
        super(`The attachments and query results are too large to publish, the cloud takes ${Math.round(limit / (1024 * 1024))} MB at most. `
            + 'Publish without the query results or with fewer attachments.');
        this.name = 'CloudPublishTooLargeError';
    }
}

/// The length of an INSERT statement at which the next row goes into another one
const DEFAULT_MAX_STATEMENT_LENGTH = 512 * 1024;

/// The Hyper type of a column of a workbook table
const WORKBOOK_COLUMN_TYPES = { text: 'text', integer: 'integer', boolean: 'boolean' } as const;

/// The key of the rows of a version, the workbook first
const KEY_COLUMNS: CloudColumn[] = [
    { name: 'workbook_id', type: 'uuid', nullable: false },
    { name: 'version_id', type: 'uuid', nullable: false },
];

/// The columns of the type uuid. Hyper doesn't return a uuid as Arrow, the store selects its text.
const UUID_COLUMNS = new Set(KEY_COLUMNS.map(column => column.name));

/// A column in a select list, the text of a uuid
function selected(name: string): string {
    return UUID_COLUMNS.has(name) ? `CAST(${qualifiedName(name)} AS text) AS ${qualifiedName(name)}` : qualifiedName(name);
}

/// The columns of a workbook table in the cloud, without the key
function workbookColumns(tableName: WorkbookTableName): CloudColumn[] {
    return WORKBOOK_TABLE_COLUMNS[tableName].filter(column => column.name !== 'workbook_id').map(column => ({
        name: column.name,
        type: WORKBOOK_COLUMN_TYPES[column.type],
        nullable: column.nullable,
    }));
}

/// The columns that this client reads and writes, by table. The migrations have to create them all.
export function cloudColumnsUsed(): Record<string, string[]> {
    const names = (columns: CloudColumn[]) => columns.map(column => column.name);
    const columns: Record<string, string[]> = {
        [CLOUD_VERSIONS_TABLE]: [...names(KEY_COLUMNS), ...names(workbookColumns(WORKBOOK_TABLE)), 'state', 'created_at', 'ready_at', 'updated_at', 'published_by', 'app_version'],
    };
    for (const tableName of CLOUD_MERGED_TABLE_NAMES) columns[tableName] = [...names(KEY_COLUMNS), ...names(workbookColumns(tableName))];
    columns[CLOUD_WORKBOOKS_TABLE] = ['workbook_id', 'folder_id', 'created_at', 'created_by', 'updated_at', 'deleted_at'];
    columns[CLOUD_FOLDERS_TABLE] = ['folder_id', 'name', 'created_at', 'created_by', 'updated_at', 'deleted_at'];
    return columns;
}

/// A fresh id of a version
export function newVersionId(): string {
    return crypto.randomUUID();
}

/// A data table of DashQL. The store only drops tables with such names, whatever the rows say.
function dataTable(tableName: string, options: CloudStoreOptions): string {
    if (!isDataTableName(tableName)) {
        throw new Error(`Not the name of a data table: ${tableName}`);
    }
    return cloudTable(tableName, options);
}

function versionsTable(options: CloudStoreOptions): string {
    return cloudTable(CLOUD_VERSIONS_TABLE, options);
}

function workbooksTable(options: CloudStoreOptions): string {
    return cloudTable(CLOUD_WORKBOOKS_TABLE, options);
}

/// The condition on a row of the versions table `v` that its workbook wasn't deleted
function liveWorkbook(options: CloudStoreOptions): string {
    return `NOT EXISTS (SELECT 1 FROM ${workbooksTable(options)} w WHERE w.workbook_id = v.workbook_id AND w.deleted_at IS NOT NULL)`;
}

/// The text of a value of a workbook table
function valueText(value: unknown): string | null {
    return value == null ? null : String(value);
}

/// The rows of a workbook table as the text of their values, the key first
function versionRows(key: CloudVersionKey, columns: readonly CloudColumn[], rows: readonly object[]): Array<Array<string | null>> {
    return rows.map(row => [key.workbookId, key.versionId, ...columns.map(column => valueText((row as Record<string, unknown>)[column.name]))]);
}

/// The condition that selects the rows of a version
function versionWhere(key: CloudVersionKey): string {
    return `workbook_id = ${quoteLiteral(key.workbookId)} AND version_id = ${quoteLiteral(key.versionId)}`;
}

/// The ready versions of the workbooks, numbered per workbook in the order they turned ready, the latest last.
/// Two versions that turned ready at the same time are ordered by their ids, every reader numbers them the same.
function numberedVersions(rows: readonly CloudWorkbookVersion[]): CloudWorkbookVersion[] {
    const sorted = rows.filter(row => row.state === 'ready').sort((a, b) =>
        a.workbookId.localeCompare(b.workbookId) || (a.readyAt ?? 0) - (b.readyAt ?? 0) || a.versionId.localeCompare(b.versionId));
    let version = 0;
    return sorted.map((row, index) => {
        version = index > 0 && sorted[index - 1].workbookId === row.workbookId ? version + 1 : 1;
        return { ...row, version };
    });
}

/// The latest version of every workbook among ready rows, the latest published first
function latestVersions(rows: readonly CloudWorkbookVersion[]): CloudWorkbookVersion[] {
    const latest = new Map<string, CloudWorkbookVersion>();
    for (const row of numberedVersions(rows)) latest.set(row.workbookId, row);
    return [...latest.values()].sort((a, b) => (b.readyAt ?? 0) - (a.readyAt ?? 0) || a.workbookId.localeCompare(b.workbookId));
}

/// Publish the workbook of a set of tables as a version, the tables hold one workbook.
///
/// Without a workbook id the publish starts a new workbook under a fresh id. With one it adds a version to the workbook.
///
/// 0. A new workbook gets its row in the workbooks table, in its folder. A deleted workbook takes no versions.
/// 1. A row of the versions table marks the upload, in state `uploading`, with the workbook row.
/// 2. The rows of the merged tables are inserted under the id of the version. Every attachment and result gets a table
///    under a fresh name: its row in the attachments or results table first, then the table, filled before the next one.
/// 3. The row turns `ready`, a single UPDATE: readers see the earlier version until then, this one after. Of two
///    publishes at the same time the one that turns ready last is the current version, both stay versions.
///
/// A failed publish removes what it wrote, also when a cleanup took its row away in the meantime. What a lost connection
/// leaves behind stays `uploading` until a cleanup removes it. `local` reads the Parquet files of the data tables.
export async function publishCloudWorkbook(
    query: CloudQuery,
    local: ParquetReadDatabase,
    tables: WorkbookTables,
    options: CloudPublishOptions = {},
): Promise<CloudWorkbookVersion> {
    if (tables[WORKBOOK_TABLE].length !== 1) {
        throw new Error(`Expected one workbook, found ${tables[WORKBOOK_TABLE].length}`);
    }
    for (const name of [...tables[ATTACHMENTS_TABLE].map(row => row.table_name), ...tables[RESULTS_TABLE].map(row => row.table_name)]) {
        if (!isDataTableName(name)) throw new Error(`Not the name of a data table: ${name}`);
        if (!tables.data.has(name)) throw new Error(`Missing data table: ${name}`);
    }
    // The text of the values is at least as large as the Parquet files, larger files are refused before anything is sent
    const maxDataBytes = options.maxDataBytes ?? DEFAULT_MAX_DATA_BYTES;
    let dataBytes = 0;
    for (const file of tables.data.values()) dataBytes += file.bytes.size;
    if (dataBytes > maxDataBytes) throw new CloudPublishTooLargeError(maxDataBytes);
    dataBytes = 0;
    await openCloudStore(query, 'write', options);
    const signal = options.signal;
    const maxLength = options.maxStatementLength ?? DEFAULT_MAX_STATEMENT_LENGTH;
    const workbookId = options.workbookId == null ? crypto.randomUUID() : checkCloudId(options.workbookId, 'workbook');
    if (options.folderId != null) checkCloudId(options.folderId, 'folder');
    const versionId = newVersionId();
    const key: CloudVersionKey = { workbookId, versionId };
    const workbook = tables[WORKBOOK_TABLE][0];
    // The data tables of every publish get fresh names, the tables of the cloud are shared by all versions
    const created: string[] = [];

    const createdRow = await ensureWorkbookRow(query, workbookId, options);

    const versionColumns = workbookColumns(WORKBOOK_TABLE);
    const versionValues = [quoteLiteral(workbookId), quoteLiteral(versionId), ...versionColumns.map(column => {
        const value = valueText((workbook as unknown as Record<string, unknown>)[column.name]);
        return value == null ? 'NULL' : `CAST(${quoteLiteral(value)} AS ${column.type})`;
    })];
    try {
        await query(`INSERT INTO ${versionsTable(options)} (${[...KEY_COLUMNS, ...versionColumns].map(column => qualifiedName(column.name)).join(', ')}, `
            + `state, created_at, ready_at, updated_at, published_by, app_version) VALUES (${versionValues.join(', ')}, 'uploading', now(), NULL, now(), `
            + `${nullableLiteral(options.publishedBy)}, ${nullableLiteral(options.appVersion ?? DASHQL_VERSION)})`, signal);
        for (const tableName of CLOUD_MERGED_TABLE_NAMES) {
            if (tableName === ATTACHMENTS_TABLE || tableName === RESULTS_TABLE) continue;
            const columns = workbookColumns(tableName);
            await insertRows(query, cloudTable(tableName, options), [...KEY_COLUMNS, ...columns], versionRows(key, columns, tables[tableName]), maxLength, signal);
        }
        for (const [tableName, prefix] of [[ATTACHMENTS_TABLE, ATTACHMENT_TABLE_PREFIX], [RESULTS_TABLE, RESULT_TABLE_PREFIX]] as const) {
            const columns = workbookColumns(tableName);
            for (const row of tables[tableName]) {
                const name = newDataTableName(prefix);
                created.push(name);
                await insertRows(query, cloudTable(tableName, options), [...KEY_COLUMNS, ...columns], versionRows(key, columns, [{ ...row, table_name: name }]), maxLength, signal);
                const { columns: dataColumns, rows } = await readDataTable(local, tableName === ATTACHMENTS_TABLE
                    ? `the attachment ${(row as AttachmentRow).name}`
                    : `a query result`, tables.data.get(row.table_name)!.bytes, signal);
                for (const values of rows) for (const value of values) dataBytes += value?.length ?? 0;
                if (dataBytes > maxDataBytes) throw new CloudPublishTooLargeError(maxDataBytes);
                await query(createTableSQL(dataTable(name, options), dataColumns), signal);
                await insertRows(query, dataTable(name, options), dataColumns, rows, maxLength, signal);
            }
        }
        await query(`UPDATE ${versionsTable(options)} SET state = 'ready', ready_at = now(), updated_at = now() `
            + `WHERE ${versionWhere(key)} AND state = 'uploading'`, signal);
        const published = (await readVersions(query, workbookId, options)).find(row => row.versionId === versionId);
        if (published == null) {
            throw new Error(`The publish of workbook ${workbookId} did not complete`);
        }
        return published;
    } catch (error) {
        // The publish is abandoned, a cleanup removes what this leaves behind
        const unsignaled = { ...options, signal: undefined };
        await dropVersion(query, key, unsignaled, created).catch(() => {});
        if (createdRow) {
            await query(`DELETE FROM ${workbooksTable(options)} w WHERE workbook_id = ${quoteLiteral(workbookId)} `
                + `AND NOT EXISTS (SELECT 1 FROM ${versionsTable(options)} v WHERE v.workbook_id = w.workbook_id)`).catch(() => {});
        }
        throw error;
    }
}

/// Make sure that a workbook has its row before a version is added to it, in the folder of the options if the row is
/// new. Refuses a deleted workbook. Returns whether the row is new.
async function ensureWorkbookRow(query: CloudQuery, workbookId: string, options: CloudPublishOptions): Promise<boolean> {
    const rows = await query(`SELECT deleted_at IS NOT NULL AS deleted FROM ${workbooksTable(options)} WHERE workbook_id = ${quoteLiteral(workbookId)}`, options.signal);
    if ([...rows].some(row => Boolean(row.deleted))) {
        throw new Error(`The workbook ${workbookId} was deleted, restore it to publish to it`);
    }
    if (rows.numRows > 0) return false;
    if (options.folderId != null) {
        const folders = await query(`SELECT count(*) AS n FROM ${cloudTable(CLOUD_FOLDERS_TABLE, options)} `
            + `WHERE folder_id = ${quoteLiteral(options.folderId)} AND deleted_at IS NULL`, options.signal);
        if (Number(folders.get(0)!.n) === 0) throw new Error(`The cloud holds no folder ${options.folderId}`);
    }
    await query(`INSERT INTO ${workbooksTable(options)} (workbook_id, folder_id, created_at, created_by, updated_at, deleted_at) `
        + `VALUES (${quoteLiteral(workbookId)}, ${options.folderId == null ? 'NULL' : `CAST(${quoteLiteral(options.folderId)} AS uuid)`}, now(), `
        + `${nullableLiteral(options.publishedBy)}, now(), NULL)`, options.signal);
    return true;
}

function nullableLiteral(value: string | null | undefined): string {
    return value == null ? 'NULL' : quoteLiteral(value);
}

/// Read a data table to publish, with an error that names it if the embedded Hyper can't read it
async function readDataTable(local: ParquetReadDatabase, what: string, file: Blob, signal?: AbortSignal): ReturnType<typeof readParquetAsText> {
    try {
        return await readParquetAsText(local, file, signal);
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(`Can't publish ${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function insertRows(
    query: CloudQuery,
    table: string,
    columns: readonly CloudColumn[],
    rows: Iterable<ReadonlyArray<string | null>>,
    maxLength: number,
    signal?: AbortSignal,
): Promise<void> {
    for (const statement of insertStatements(table, columns, rows, maxLength)) {
        await query(statement, signal);
    }
}
/// The columns of a Parquet file and its rows as the text of their values, read by the embedded Hyper
export async function readParquetAsText(local: ParquetReadDatabase, file: Blob, signal?: AbortSignal): Promise<{ columns: CloudColumn[]; rows: Array<Array<string | null>> }> {
    const path = await local.registerExternalFile(`${crypto.randomUUID()}.parquet`, file, undefined, signal);
    try {
        const connection = await local.connect({ pooled: true });
        try {
            const source = `external(${quoteLiteral(path)}, format => 'parquet')`;
            const schema = await connection.query(`SELECT * FROM ${source} LIMIT 0`, signal);
            const { types } = prepareHyperArrowInsert(schema);
            const columns = schema.schema.fields.map((field, index) => ({ name: field.name, type: types[index], nullable: true }));
            const text = await connection.query(
                `SELECT ${columns.map(column => `CAST(${qualifiedName(column.name)} AS text)`).join(', ')} FROM ${source}`,
                signal,
            );
            const vectors = columns.map((_, index) => text.getChildAt(index)!);
            const rows: Array<Array<string | null>> = [];
            for (let row = 0; row < text.numRows; ++row) {
                rows.push(vectors.map(vector => valueText(vector.get(row))));
            }
            return { columns, rows };
        } finally {
            await connection.close();
        }
    } finally {
        await local.removeExternalFile(path);
    }
}

/// Read rows of the versions table, `where` is a condition on the row `v`
async function readVersionRows(query: CloudQuery, where: string, options: CloudStoreOptions): Promise<CloudWorkbookVersion[]> {
    const table = await query(`SELECT ${selected('version_id')}, ${selected('workbook_id')}, state, name, format_version, created_at, ready_at, updated_at, `
        + `published_by, app_version `
        + `FROM ${versionsTable(options)} v WHERE ${where}`, options.signal);
    const rows: CloudWorkbookVersion[] = [];
    for (const row of table) {
        rows.push({
            workbookId: String(row.workbook_id),
            versionId: String(row.version_id),
            version: 0,
            state: String(row.state) as CloudVersionState,
            name: row.name == null ? null : String(row.name),
            publishedBy: row.published_by == null ? null : String(row.published_by),
            appVersion: row.app_version == null ? null : String(row.app_version),
            formatVersion: Number(row.format_version),
            createdAt: Number(row.created_at),
            readyAt: row.ready_at == null ? null : Number(row.ready_at),
            updatedAt: Number(row.updated_at),
        });
    }
    return rows;
}

/// The workbooks that weren't deleted by their latest versions, the latest published first
export async function listCloudWorkbooks(query: CloudQuery, options: CloudStoreOptions = {}): Promise<CloudWorkbook[]> {
    const view = await openCloudStore(query, 'read', options);
    if (!view.columns.has(CLOUD_VERSIONS_TABLE)) return [];
    const latest = latestVersions(await readVersionRows(query, `state = 'ready' AND ${liveWorkbook(options)}`, options));
    // Two clients that published the first version of a workbook with the same id at the same time may have written two
    // rows, the one created first counts
    const folders = new Map<string, string | null>();
    const rows = await query(`SELECT CAST(workbook_id AS text) AS workbook_id, CAST(folder_id AS text) AS folder_id FROM ${workbooksTable(options)} `
        + `ORDER BY created_at DESC, folder_id DESC`, options.signal);
    for (const row of rows) folders.set(String(row.workbook_id), row.folder_id == null ? null : String(row.folder_id));
    return latest.map(version => ({ ...version, folderId: folders.get(version.workbookId) ?? null }));
}

/// The workbooks whose latest versions have a text in their names or in the text of a script, like listCloudWorkbooks,
/// ignoring case
export async function searchCloudWorkbooks(query: CloudQuery, text: string, options: CloudStoreOptions = {}): Promise<CloudWorkbook[]> {
    const workbooks = await listCloudWorkbooks(query, options);
    const needle = text.trim().toLowerCase();
    if (needle.length === 0 || workbooks.length === 0) return workbooks;
    const scripts = await query(`SELECT DISTINCT CAST(workbook_id AS text) AS workbook_id, CAST(version_id AS text) AS version_id `
        + `FROM ${cloudTable(SCRIPTS_TABLE, options)} WHERE strpos(lower(text), ${quoteLiteral(needle)}) > 0`, options.signal);
    const matches = new Set([...scripts].map(row => `${row.workbook_id}/${row.version_id}`));
    return workbooks.filter(workbook => (workbook.name ?? '').toLowerCase().includes(needle) || matches.has(`${workbook.workbookId}/${workbook.versionId}`));
}

/// The versions of a workbook, the latest first
export async function listCloudWorkbookVersions(query: CloudQuery, workbookId: string, options: CloudStoreOptions = {}): Promise<CloudWorkbookVersion[]> {
    checkCloudId(workbookId, 'workbook');
    const view = await openCloudStore(query, 'read', options);
    if (!view.columns.has(CLOUD_VERSIONS_TABLE)) return [];
    return await readVersions(query, workbookId, options);
}

/// The ready versions of a workbook, the latest first
async function readVersions(query: CloudQuery, workbookId: string, options: CloudStoreOptions): Promise<CloudWorkbookVersion[]> {
    const rows = await readVersionRows(query, `workbook_id = ${quoteLiteral(workbookId)} AND state = 'ready' AND ${liveWorkbook(options)}`, options);
    return numberedVersions(rows).reverse();
}

/// Read the tables of a version of a workbook, named by its id, the latest without one. `local` writes the attachment
/// and result tables as Parquet files.
export async function readCloudWorkbook(
    query: CloudQuery,
    local: ParquetReadDatabase,
    workbookId: string,
    options: CloudStoreOptions & { versionId?: string } = {},
): Promise<{ version: CloudWorkbookVersion; tables: WorkbookTables }> {
    checkCloudId(workbookId, 'workbook');
    if (options.versionId != null) checkCloudId(options.versionId, 'version');
    const view = await openCloudStore(query, 'read', options);
    const signal = options.signal;
    const versions = view.columns.has(CLOUD_VERSIONS_TABLE) ? await readVersions(query, workbookId, options) : [];
    const row = options.versionId == null ? versions[0] : versions.find(version => version.versionId === options.versionId);
    if (row == null) {
        throw new Error(options.versionId == null
            ? `The cloud holds no workbook ${workbookId}`
            : `The cloud holds no version ${options.versionId} of workbook ${workbookId}`);
    }
    if (row.formatVersion > WORKBOOK_FORMAT_VERSION) {
        throw new Error(`The workbook ${workbookId} was published by a newer DashQL, update DashQL to read it`);
    }
    const tables = emptyWorkbookTables();
    // The tables may lack columns and tables that this client knows, of migrations that no writer ran yet. A missing
    // column reads as null, a missing table as one without rows.
    const read = async <N extends WorkbookTableName>(tableName: N, cloudTableName: string): Promise<WorkbookTables[N]> => {
        const existing = view.columns.get(cloudTableName);
        const columns = WORKBOOK_TABLE_COLUMNS[tableName].filter(column => existing?.has(column.name)).map(column => column.name);
        if (columns.length === 0) return [] as unknown as WorkbookTables[N];
        const result = await query(`SELECT ${columns.map(selected).join(', ')} FROM ${cloudTable(cloudTableName, options)} `
            + `WHERE ${versionWhere(row)} ORDER BY ${columns.map(name => qualifiedName(name)).join(', ')}`, signal);
        return workbookTableFromArrow(tableName, result);
    };
    tables[WORKBOOK_TABLE] = await read(WORKBOOK_TABLE, CLOUD_VERSIONS_TABLE);
    for (const tableName of CLOUD_MERGED_TABLE_NAMES) {
        (tables as unknown as Record<WorkbookTableName, object[]>)[tableName] = await read(tableName, tableName);
    }
    for (const name of [...tables[ATTACHMENTS_TABLE].map(row => row.table_name), ...tables[RESULTS_TABLE].map(row => row.table_name)]) {
        const result = await query(`SELECT * FROM ${dataTable(name, options)}`, signal);
        const bytes = await exportArrowTableAsParquet(local, result);
        tables.data.set(name, { bytes: new Blob([bytes as Uint8Array<ArrayBuffer>]) });
    }
    return { version: row, tables };
}

/// Delete a workbook with all its versions. A single UPDATE marks its row, the workbook is hidden from then on and can be
/// restored until a cleanup removes it.
export async function deleteCloudWorkbook(query: CloudQuery, workbookId: string, options: CloudStoreOptions = {}): Promise<void> {
    checkCloudId(workbookId, 'workbook');
    await openCloudStore(query, 'write', options);
    const id = quoteLiteral(workbookId);
    const rows = await query(`SELECT count(*) AS n FROM ${workbooksTable(options)} WHERE workbook_id = ${id}`, options.signal);
    if (Number(rows.get(0)!.n) === 0) {
        await query(`INSERT INTO ${workbooksTable(options)} (workbook_id, folder_id, created_at, created_by, updated_at, deleted_at) `
            + `VALUES (${id}, NULL, now(), NULL, now(), now())`, options.signal);
    } else {
        await query(`UPDATE ${workbooksTable(options)} SET deleted_at = now(), updated_at = now() WHERE workbook_id = ${id} AND deleted_at IS NULL`, options.signal);
    }
}

/// Restore a deleted workbook that no cleanup removed yet
export async function restoreCloudWorkbook(query: CloudQuery, workbookId: string, options: CloudStoreOptions = {}): Promise<void> {
    checkCloudId(workbookId, 'workbook');
    await openCloudStore(query, 'write', options);
    await query(`UPDATE ${workbooksTable(options)} SET deleted_at = NULL, updated_at = now() WHERE workbook_id = ${quoteLiteral(workbookId)}`, options.signal);
}

/// Remove a version: its row turns `deleting`, its data tables are dropped, then its rows of the merged tables are
/// removed and its row last. Every step can run again, so a remove that stops halfway is completed by a cleanup.
/// `dataTables` names data tables of the version that its rows may not name, those of a failed publish.
///
/// A data table that a row of another version names stays. No client shares data tables between versions yet, but one
/// that does can rely on every client keeping a shared table.
async function dropVersion(query: CloudQuery, key: CloudVersionKey, options: CloudStoreOptions, dataTables: readonly string[] = []): Promise<void> {
    const where = versionWhere(key);
    await query(`UPDATE ${versionsTable(options)} SET state = 'deleting', updated_at = now() WHERE ${where}`, options.signal);
    const named = await query(`SELECT table_name FROM ${cloudTable(ATTACHMENTS_TABLE, options)} WHERE ${where} `
        + `UNION SELECT table_name FROM ${cloudTable(RESULTS_TABLE, options)} WHERE ${where}`, options.signal);
    const names = new Set(dataTables);
    for (const row of named) names.add(String(row.table_name));
    // A row that doesn't name a data table stays, nothing else is dropped
    const dropped = [...names].filter(isDataTableName);
    if (dropped.length > 0) {
        const list = dropped.map(quoteLiteral).join(', ');
        const shared = await query(`SELECT table_name FROM ${cloudTable(ATTACHMENTS_TABLE, options)} WHERE table_name IN (${list}) AND NOT (${where}) `
            + `UNION SELECT table_name FROM ${cloudTable(RESULTS_TABLE, options)} WHERE table_name IN (${list}) AND NOT (${where})`, options.signal);
        const kept = new Set([...shared].map(row => String(row.table_name)));
        for (const name of dropped) {
            if (!kept.has(name)) await query(`DROP TABLE IF EXISTS ${dataTable(name, options)}`, options.signal);
        }
    }
    for (const tableName of CLOUD_MERGED_TABLE_NAMES) {
        await query(`DELETE FROM ${cloudTable(tableName, options)} WHERE ${where}`, options.signal);
    }
    await query(`DELETE FROM ${versionsTable(options)} WHERE ${where}`, options.signal);
}

export interface CloudCleanupOptions extends CloudStoreOptions {
    /// An upload that hasn't completed for this long is abandoned, one hour by default.
    /// Uploads of other clients may still run, younger ones are left alone.
    staleAfterSeconds?: number;
    /// A workbook or a folder that was deleted this long ago is removed, 30 days by default. It can be restored until then.
    purgeAfterSeconds?: number;
}

/// What a cleanup removed
export interface CloudCleanup {
    versions: CloudVersionKey[];
    workbooks: string[];
    folders: string[];
}

/// Remove the workbooks and folders that were deleted long ago, the versions that are being deleted, the uploads that
/// were abandoned, and the rows of versions that have no row any more.
export async function cleanupCloud(query: CloudQuery, options: CloudCleanupOptions = {}): Promise<CloudCleanup> {
    await openCloudStore(query, 'write', options);
    const staleAfter = Math.max(0, Math.floor(options.staleAfterSeconds ?? 60 * 60));
    const purgeAfter = Math.max(0, Math.floor(options.purgeAfterSeconds ?? 30 * 24 * 60 * 60));
    const workbooks = await purgeWorkbooks(query, staleAfter, purgeAfter, options);
    const folders = await purgeFolders(query, purgeAfter, options);
    const abandoned = await readVersionRows(query,
        `state = 'deleting' OR (state = 'uploading' AND updated_at < now() - INTERVAL '${staleAfter} seconds')`, options);
    const removed: CloudVersionKey[] = abandoned.map(({ workbookId, versionId }) => ({ workbookId, versionId }));
    // An upload that went on after a cleanup removed its version leaves rows without a version. A version row is written
    // before any other row of its version, so the rows of uploads that still run always have one.
    const orphans = await query(CLOUD_MERGED_TABLE_NAMES.map(tableName => `SELECT CAST(t.workbook_id AS text) AS workbook_id, CAST(t.version_id AS text) AS version_id FROM ${cloudTable(tableName, options)} t `
        + `WHERE NOT EXISTS (SELECT 1 FROM ${versionsTable(options)} v WHERE v.workbook_id = t.workbook_id AND v.version_id = t.version_id)`)
        .join(' UNION '), options.signal);
    for (const row of orphans) removed.push({ workbookId: String(row.workbook_id), versionId: String(row.version_id) });
    for (const key of removed) {
        await dropVersion(query, key, options);
    }
    return { versions: [...workbooks.versions, ...removed], workbooks: workbooks.workbooks, folders };
}

/// Remove the workbooks that were deleted long ago with all their versions, their rows last, and the rows of workbooks
/// whose first publish was abandoned
async function purgeWorkbooks(query: CloudQuery, staleAfter: number, purgeAfter: number, options: CloudStoreOptions): Promise<{ versions: CloudVersionKey[]; workbooks: string[] }> {
    const table = workbooksTable(options);
    const deleted = await query(`SELECT DISTINCT CAST(workbook_id AS text) AS workbook_id FROM ${table} `
        + `WHERE deleted_at < now() - INTERVAL '${purgeAfter} seconds'`, options.signal);
    const versions: CloudVersionKey[] = [];
    const workbooks: string[] = [];
    for (const row of deleted) {
        const id = String(row.workbook_id);
        for (const version of await readVersionRows(query, `workbook_id = ${quoteLiteral(id)}`, options)) {
            await dropVersion(query, version, options);
            versions.push({ workbookId: version.workbookId, versionId: version.versionId });
        }
        await query(`DELETE FROM ${table} WHERE workbook_id = ${quoteLiteral(id)}`, options.signal);
        workbooks.push(id);
    }
    // A workbook row is written before the first version of the workbook, a publish that never got to the version leaves it
    const empty = `deleted_at IS NULL AND created_at < now() - INTERVAL '${staleAfter} seconds' `
        + `AND NOT EXISTS (SELECT 1 FROM ${versionsTable(options)} v WHERE v.workbook_id = w.workbook_id)`;
    const abandoned = await query(`SELECT DISTINCT CAST(workbook_id AS text) AS workbook_id FROM ${table} w WHERE ${empty}`, options.signal);
    if (abandoned.numRows > 0) {
        await query(`DELETE FROM ${table} w WHERE ${empty}`, options.signal);
        for (const row of abandoned) workbooks.push(String(row.workbook_id));
    }
    return { versions, workbooks };
}

/// Remove the folders that were deleted long ago. Their workbooks showed at the top already and move there first.
async function purgeFolders(query: CloudQuery, purgeAfter: number, options: CloudStoreOptions): Promise<string[]> {
    const table = cloudTable(CLOUD_FOLDERS_TABLE, options);
    const deleted = await query(`SELECT CAST(folder_id AS text) AS folder_id FROM ${table} `
        + `WHERE deleted_at < now() - INTERVAL '${purgeAfter} seconds'`, options.signal);
    const purged: string[] = [];
    for (const row of deleted) {
        const id = quoteLiteral(String(row.folder_id));
        await query(`UPDATE ${workbooksTable(options)} SET folder_id = NULL, updated_at = now() WHERE folder_id = ${id}`, options.signal);
        await query(`DELETE FROM ${table} WHERE folder_id = ${id}`, options.signal);
        purged.push(String(row.folder_id));
    }
    return purged;
}
