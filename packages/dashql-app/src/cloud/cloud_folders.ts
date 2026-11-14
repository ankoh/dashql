import { SCRIPTS_TABLE } from '@ankoh/dashql-sdk/storage/workbook_tables';
import { quoteLiteral } from './cloud_sql.js';
import { CLOUD_FOLDER_DEPTH, latestVersionsSQL, versionFromRow, type CloudWorkbook } from './cloud_store.js';
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

// The folders of the published workbooks in the cloud. See docs/design/cloud.md.
//
// Folders nest: a folder names its parent, null at the top, and a workbook names its folder. So renaming or moving a
// folder and moving a workbook are single UPDATEs. Deleting a folder moves its folders and workbooks to its parent and
// then marks it. A folder or a workbook whose parent or folder was deleted or doesn't exist shows at the top, so what a
// race leaves behind still shows. Clients check the names of folders among their siblings before they write, two
// folders of the same name that two clients created at the same time show side by side.
//
// Nothing here reads all folders or all workbooks: a listing reads a page of a folder, or of the workbooks that a search
// finds, sorted by name in SQL.

/// A row of the folders table
export interface CloudFolder {
    folderId: string;
    /// The parent as the folder shows: null at the top, also when the parent that its row names was deleted or doesn't
    /// exist
    parentId: string | null;
    name: string;
    createdBy: string | null;
    /// Milliseconds since the epoch
    createdAt: number;
    /// Milliseconds since the epoch
    updatedAt: number;
    /// Milliseconds since the epoch, null unless deleted
    deletedAt: number | null;
}

export interface CloudFolderOptions extends CloudStoreOptions {
    /// Who creates the folder, the login of the cloud connection
    createdBy?: string;
}

/// The entries of a page of a listing
export const CLOUD_PAGE_SIZE = 100;

/// A search of the workbooks
export interface CloudSearch {
    /// A text that the name of the latest version or one of its scripts contains, ignoring case
    text: string;
}

/// Where the next page of a listing starts, after this entry
export interface CloudCursor {
    kind: 'folder' | 'workbook';
    /// The name of the entry as the listing sorts it
    name: string;
    id: string;
}

/// An entry of a listing
export type CloudEntry =
    /// A folder with the numbers of the folders and workbooks that it shows
    | { kind: 'folder'; folder: CloudFolder; folders: number; workbooks: number }
    /// A workbook with the name of the folder that it shows in, null at the top
    | { kind: 'workbook'; workbook: CloudWorkbook; folderName: string | null };

export interface CloudListRequest {
    /// The folder to list, null for the top. Without a search.
    folderId: string | null;
    /// Search the workbooks of the whole cloud instead of listing the folder
    search?: CloudSearch | null;
    /// Continue after this entry, the `next` of the previous page
    after?: CloudCursor | null;
    /// The most entries of the page, CLOUD_PAGE_SIZE by default
    limit?: number;
}

/// A page of a listing
export interface CloudPage {
    entries: CloudEntry[];
    /// Where the next page starts, null on the last page
    next: CloudCursor | null;
}

function foldersTable(options: CloudStoreOptions): string {
    return cloudTable(CLOUD_FOLDERS_TABLE, options);
}

function workbooksTable(options: CloudStoreOptions): string {
    return cloudTable(CLOUD_WORKBOOKS_TABLE, options);
}

/// The condition that a folder `p` shows
const LIVE_PARENT = 'p.deleted_at IS NULL';

/// The select list of a folder `f`, joined with its parent `p` if it shows (parentJoin)
const FOLDER_COLUMNS = 'CAST(f.folder_id AS text) AS folder_id, CAST(p.folder_id AS text) AS parent_id, f.name, f.created_by, f.created_at, '
    + 'f.updated_at, f.deleted_at';

/// Join a folder `f` with its parent `p` if that shows
function parentJoin(options: CloudStoreOptions): string {
    return ` LEFT JOIN ${foldersTable(options)} p ON p.folder_id = f.parent_id AND ${LIVE_PARENT}`;
}

function folderFromRow(row: Record<string, unknown>): CloudFolder {
    return {
        folderId: String(row.folder_id),
        parentId: row.parent_id == null ? null : String(row.parent_id),
        name: String(row.name),
        createdBy: row.created_by == null ? null : String(row.created_by),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
    };
}

/// Read a folder by its id, also a deleted one, null if there is none
async function readFolder(query: CloudQuery, folderId: string, options: CloudStoreOptions): Promise<CloudFolder | null> {
    const table = await query(`SELECT ${FOLDER_COLUMNS} FROM ${foldersTable(options)} f${parentJoin(options)} `
        + `WHERE f.folder_id = ${quoteLiteral(folderId)}`, options.signal);
    const row = table.get(0);
    return row == null ? null : folderFromRow(row as unknown as Record<string, unknown>);
}

/// Read a folder that wasn't deleted, throw if there is none
async function readLiveFolder(query: CloudQuery, folderId: string, options: CloudStoreOptions): Promise<CloudFolder> {
    const folder = await readFolder(query, folderId, options);
    if (folder == null || folder.deletedAt != null) throw new Error(`The cloud holds no folder ${folderId}`);
    return folder;
}

/// The condition that a folder `f` that wasn't deleted shows in a folder, at the top without one
function inFolder(parentId: string | null, options: CloudStoreOptions): string {
    if (parentId != null) return `f.parent_id = ${quoteLiteral(parentId)}`;
    return `(f.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM ${foldersTable(options)} p WHERE p.folder_id = f.parent_id AND ${LIVE_PARENT}))`;
}

/// Check the name of a folder, the folders of a parent have names that differ ignoring case
async function checkName(query: CloudQuery, name: string, parentId: string | null, except: string | null, options: CloudStoreOptions): Promise<string> {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('A folder needs a name');
    const table = await query(`SELECT count(*) AS n FROM ${foldersTable(options)} f WHERE f.deleted_at IS NULL AND ${inFolder(parentId, options)} `
        + `AND lower(f.name) = lower(${quoteLiteral(trimmed)})${except == null ? '' : ` AND f.folder_id <> ${quoteLiteral(except)}`}`, options.signal);
    if (Number(table.get(0)!.n) > 0) throw new Error(`A folder ${trimmed} exists already`);
    return trimmed;
}

/// Create a folder in a folder, at the top without one
export async function createCloudFolder(query: CloudQuery, name: string, parentId: string | null, options: CloudFolderOptions = {}): Promise<CloudFolder> {
    if (parentId != null) checkCloudId(parentId, 'folder');
    await openCloudStore(query, 'write', options);
    if (parentId != null) await readLiveFolder(query, parentId, options);
    const checked = await checkName(query, name, parentId, null, options);
    const folderId = crypto.randomUUID();
    await query(`INSERT INTO ${foldersTable(options)} (folder_id, parent_id, name, created_at, created_by, updated_at, deleted_at) `
        + `VALUES (${quoteLiteral(folderId)}, ${parentId == null ? 'NULL' : `CAST(${quoteLiteral(parentId)} AS uuid)`}, ${quoteLiteral(checked)}, now(), `
        + `${options.createdBy == null ? 'NULL' : quoteLiteral(options.createdBy)}, now(), NULL)`, options.signal);
    const created = await readFolder(query, folderId, options);
    if (created == null) throw new Error(`The folder ${checked} was not created`);
    return created;
}

/// Rename a folder
export async function renameCloudFolder(query: CloudQuery, folderId: string, name: string, options: CloudStoreOptions = {}): Promise<void> {
    checkCloudId(folderId, 'folder');
    await openCloudStore(query, 'write', options);
    const folder = await readLiveFolder(query, folderId, options);
    const checked = await checkName(query, name, folder.parentId, folderId, options);
    await query(`UPDATE ${foldersTable(options)} SET name = ${quoteLiteral(checked)}, updated_at = now() `
        + `WHERE folder_id = ${quoteLiteral(folderId)}`, options.signal);
}

/// Move a folder into another folder, to the top without one. Refuses to move a folder into itself or into one of its
/// folders.
export async function moveCloudFolder(query: CloudQuery, folderId: string, parentId: string | null, options: CloudStoreOptions = {}): Promise<void> {
    checkCloudId(folderId, 'folder');
    if (parentId != null) checkCloudId(parentId, 'folder');
    await openCloudStore(query, 'write', options);
    const folder = await readLiveFolder(query, folderId, options);
    if (parentId != null) {
        const path = await walkUp(query, parentId, options);
        if (path.some(ancestor => ancestor.folderId === folderId)) {
            throw new Error(`The folder ${folder.name} can't move into itself or one of its folders`);
        }
    }
    await checkName(query, folder.name, parentId, folderId, options);
    await query(`UPDATE ${foldersTable(options)} SET parent_id = ${parentId == null ? 'NULL' : `CAST(${quoteLiteral(parentId)} AS uuid)`}, `
        + `updated_at = now() WHERE folder_id = ${quoteLiteral(folderId)}`, options.signal);
}

/// Delete a folder. Its folders and workbooks move to its parent first, then it is marked. Every step is a single
/// UPDATE that may run again, a folder or a workbook that a race leaves in the deleted folder shows at the top.
export async function deleteCloudFolder(query: CloudQuery, folderId: string, options: CloudStoreOptions = {}): Promise<void> {
    checkCloudId(folderId, 'folder');
    await openCloudStore(query, 'write', options);
    const folder = await readFolder(query, folderId, options);
    if (folder == null) return;
    const id = quoteLiteral(folderId);
    const parent = folder.parentId == null ? 'NULL' : `CAST(${quoteLiteral(folder.parentId)} AS uuid)`;
    await query(`UPDATE ${foldersTable(options)} SET parent_id = ${parent}, updated_at = now() WHERE parent_id = ${id}`, options.signal);
    await query(`UPDATE ${workbooksTable(options)} SET folder_id = ${parent}, updated_at = now() WHERE folder_id = ${id}`, options.signal);
    await query(`UPDATE ${foldersTable(options)} SET deleted_at = now(), updated_at = now() WHERE folder_id = ${id} AND deleted_at IS NULL`, options.signal);
}

/// Move a workbook into a folder, to the top without one
export async function moveCloudWorkbook(query: CloudQuery, workbookId: string, folderId: string | null, options: CloudStoreOptions = {}): Promise<void> {
    checkCloudId(workbookId, 'workbook');
    if (folderId != null) checkCloudId(folderId, 'folder');
    await openCloudStore(query, 'write', options);
    if (folderId != null) await readLiveFolder(query, folderId, options);
    const id = quoteLiteral(workbookId);
    const table = await query(`SELECT `
        + `EXISTS (SELECT 1 FROM ${cloudTable(CLOUD_VERSIONS_TABLE, options)} v WHERE v.workbook_id = ${id} AND v.state = 'ready') AS ready, `
        + `EXISTS (SELECT 1 FROM ${workbooksTable(options)} w WHERE w.workbook_id = ${id} AND w.deleted_at IS NOT NULL) AS deleted, `
        + `EXISTS (SELECT 1 FROM ${workbooksTable(options)} w WHERE w.workbook_id = ${id}) AS has_row`, options.signal);
    const row = table.get(0)!;
    if (!row.ready || row.deleted) throw new Error(`The cloud holds no workbook ${workbookId}`);
    const folder = folderId == null ? 'NULL' : `CAST(${quoteLiteral(folderId)} AS uuid)`;
    if (row.has_row) {
        await query(`UPDATE ${workbooksTable(options)} SET folder_id = ${folder}, updated_at = now() WHERE workbook_id = ${id}`, options.signal);
    } else {
        // A workbook whose versions have no row of the workbook gets one
        await query(`INSERT INTO ${workbooksTable(options)} (workbook_id, folder_id, created_at, created_by, updated_at, deleted_at) `
            + `VALUES (${id}, ${folder}, now(), NULL, now(), NULL)`, options.signal);
    }
}

/// The folders from a folder up, the folder first, as far as they show. Stops at a loop and after CLOUD_FOLDER_DEPTH
/// folders. Throws if the folder doesn't show.
async function walkUp(query: CloudQuery, folderId: string, options: CloudStoreOptions): Promise<CloudFolder[]> {
    const path = [await readLiveFolder(query, folderId, options)];
    const seen = new Set([folderId]);
    for (let parentId = path[0].parentId; parentId != null && !seen.has(parentId) && path.length < CLOUD_FOLDER_DEPTH;) {
        const parent = await readFolder(query, parentId, options);
        if (parent == null || parent.deletedAt != null) break;
        path.push(parent);
        seen.add(parentId);
        parentId = parent.parentId;
    }
    return path;
}

/// The folders from the top down to a folder, the folder last. Throws if the folder was deleted or doesn't exist.
export async function readCloudFolderPath(query: CloudQuery, folderId: string, options: CloudStoreOptions = {}): Promise<CloudFolder[]> {
    checkCloudId(folderId, 'folder');
    const view = await openCloudStore(query, 'read', options);
    if (!view.columns.has(CLOUD_FOLDERS_TABLE)) throw new Error(`The cloud holds no folder ${folderId}`);
    return (await walkUp(query, folderId, options)).reverse();
}

/// The condition that the entry `e` comes after a cursor, by the sort name and the id
function after(sortName: string, id: string, cursor: CloudCursor): string {
    const name = quoteLiteral(cursor.name);
    return `(${sortName} > ${name} OR (${sortName} = ${name} AND ${id} > ${quoteLiteral(cursor.id)}))`;
}

/// The columns of an entry, the folders and the workbooks of a listing go into one result
const ENTRY_COLUMNS = [
    'kind', 'sort_name', 'id', 'folder_uuid', 'name', 'parent_id', 'created_by', 'created_at', 'updated_at', 'deleted_at',
    'version_id', 'version', 'state', 'published_by', 'app_version', 'format_version', 'ready_at', 'folder_id', 'folder_name',
] as const;

/// List a page of the folders and workbooks in a folder, or of the workbooks that a search finds in the whole cloud.
///
/// A folder lists the folders that show in it first, then its workbooks, both sorted by their names ignoring case and
/// then by their ids. The top lists the folders and workbooks without a parent or a folder, and those whose parent or
/// folder was deleted or doesn't exist. A search lists the workbooks whose latest versions have the text in their names
/// or in a script, ignoring case, sorted the same way. Pages follow each other by the last entry, a page may hold both
/// folders and workbooks. A cloud without the tables of DashQL lists nothing.
export async function listCloudEntries(query: CloudQuery, request: CloudListRequest, options: CloudStoreOptions = {}): Promise<CloudPage> {
    const limit = request.limit ?? CLOUD_PAGE_SIZE;
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`Not the size of a page: ${limit}`);
    const folderId = request.folderId;
    if (folderId != null) checkCloudId(folderId, 'folder');
    const cursor = request.after ?? null;
    if (cursor != null) checkCloudId(cursor.id, cursor.kind);
    const needle = request.search?.text.trim() ?? '';
    const view = await openCloudStore(query, 'read', options);
    if (!view.columns.has(CLOUD_VERSIONS_TABLE) || !view.columns.has(CLOUD_FOLDERS_TABLE) || !view.columns.has(CLOUD_WORKBOOKS_TABLE)) {
        return { entries: [], next: null };
    }
    const folders = foldersTable(options);
    const fetched = limit + 1;
    const parts: string[] = [];

    // The folders, unless a search lists only workbooks or the cursor is past the folders
    if (needle.length === 0 && cursor?.kind !== 'workbook') {
        const where = ['f.deleted_at IS NULL', folderId == null ? 'p.folder_id IS NULL' : `f.parent_id = ${quoteLiteral(folderId)} AND p.folder_id IS NOT NULL`];
        if (cursor != null) where.push(after('lower(f.name)', 'CAST(f.folder_id AS text)', cursor));
        parts.push(`SELECT 0 AS kind, lower(f.name) AS sort_name, CAST(f.folder_id AS text) AS id, f.folder_id AS folder_uuid, f.name, `
            + `CAST(p.folder_id AS text) AS parent_id, f.created_by, f.created_at, f.updated_at, f.deleted_at, `
            + `CAST(NULL AS text) AS version_id, CAST(NULL AS bigint) AS version, CAST(NULL AS text) AS state, CAST(NULL AS text) AS published_by, `
            + `CAST(NULL AS text) AS app_version, CAST(NULL AS integer) AS format_version, CAST(NULL AS timestamptz) AS ready_at, `
            + `CAST(NULL AS text) AS folder_id, CAST(NULL AS text) AS folder_name `
            + `FROM ${folders} f${parentJoin(options)} WHERE ${where.join(' AND ')} ORDER BY sort_name, id LIMIT ${fetched}`);
    }

    // The workbooks
    const sortName = `lower(COALESCE(e.name, ''))`;
    const where: string[] = [];
    if (needle.length > 0) {
        const text = `lower(${quoteLiteral(needle)})`;
        const scripts = ` OR EXISTS (SELECT 1 FROM ${cloudTable(SCRIPTS_TABLE, options)} s WHERE s.workbook_id = e.workbook_id `
            + `AND s.version_id = e.version_id AND strpos(lower(s.text), ${text}) > 0)`;
        where.push(`(strpos(${sortName}, ${text}) > 0${scripts})`);
    } else {
        where.push(folderId == null ? 'e.shown_folder_id IS NULL' : `e.shown_folder_id = ${quoteLiteral(folderId)}`);
    }
    if (cursor?.kind === 'workbook') where.push(after(sortName, 'CAST(e.workbook_id AS text)', cursor));
    parts.push(`SELECT 1 AS kind, ${sortName} AS sort_name, CAST(e.workbook_id AS text) AS id, CAST(NULL AS uuid) AS folder_uuid, e.name, `
        + `CAST(NULL AS text) AS parent_id, CAST(NULL AS text) AS created_by, e.created_at, e.updated_at, CAST(NULL AS timestamptz) AS deleted_at, `
        + `CAST(e.version_id AS text) AS version_id, e.version, e.state, e.published_by, e.app_version, e.format_version, e.ready_at, `
        + `CAST(e.folder_id AS text) AS folder_id, e.folder_name `
        + `FROM shown e WHERE ${where.join(' AND ')} ORDER BY sort_name, id LIMIT ${fetched}`);

    // The numbers of the folders and the workbooks that a folder of the page shows, counted for the page only
    const childFolders = `(SELECT count(*) FROM ${folders} c WHERE c.parent_id = u.folder_uuid AND c.deleted_at IS NULL)`;
    const childWorkbooks = `(SELECT count(*) FROM shown c WHERE c.shown_folder_id = u.folder_uuid)`;
    const columns = ENTRY_COLUMNS.filter(name => name !== 'folder_uuid').map(name => `u.${name}`).join(', ');
    // The workbooks by their latest versions, with the folders that they show in
    const shown = `SELECT l.*, s.folder_id AS shown_folder_id, s.name AS folder_name FROM (${latestVersionsSQL(options)}) l `
        + `LEFT JOIN ${folders} s ON s.folder_id = l.folder_id AND s.deleted_at IS NULL`;
    const sql = `WITH shown AS (${shown}) SELECT ${columns}, `
        + `CASE WHEN u.kind = 0 THEN ${childFolders} END AS child_folders, CASE WHEN u.kind = 0 THEN ${childWorkbooks} END AS child_workbooks `
        + `FROM (SELECT * FROM (${parts.map((part, index) => `SELECT * FROM (${part}) p${index}`).join(' UNION ALL ')}) a `
        + `ORDER BY kind, sort_name, id LIMIT ${fetched}) u ORDER BY u.kind, u.sort_name, u.id`;
    const rows: Array<Record<string, unknown>> = [...await query(sql, options.signal)].map(row => ({ ...row.toJSON() }));
    const entries: CloudEntry[] = rows.slice(0, limit).map(row => Number(row.kind) === 0
        ? {
            kind: 'folder',
            folder: folderFromRow({ ...row, folder_id: row.id }),
            folders: Number(row.child_folders),
            workbooks: Number(row.child_workbooks),
        }
        : {
            kind: 'workbook',
            workbook: { ...versionFromRow({ ...row, workbook_id: row.id }), folderId: row.folder_id == null ? null : String(row.folder_id) },
            folderName: row.folder_name == null ? null : String(row.folder_name),
        });
    const last = rows.length > limit ? rows[limit - 1] : null;
    return {
        entries,
        next: last == null ? null : { kind: Number(last.kind) === 0 ? 'folder' : 'workbook', name: String(last.sort_name), id: String(last.id) },
    };
}
