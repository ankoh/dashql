import { quoteLiteral } from './cloud_sql.js';
import { listCloudWorkbooks, type CloudWorkbook } from './cloud_store.js';
import {
    checkCloudId,
    CLOUD_FOLDERS_TABLE,
    CLOUD_WORKBOOKS_TABLE,
    cloudTable,
    openCloudStore,
    type CloudQuery,
    type CloudStoreOptions,
} from './cloud_store_schema.js';

// The folders of the published workbooks in the cloud. See docs/design/cloud.md.
//
// Folders don't nest: the top holds folders and workbooks, a folder holds workbooks. A workbook names its folder, so
// renaming a folder or moving a workbook is a single UPDATE. Deleting a folder only marks it, its workbooks show at the
// top from then on, as do the workbooks of a folder that doesn't exist. The cloud keeps no order, folders and workbooks
// are sorted by name. Clients check the names of folders before they write, two folders of the same name that two
// clients created at the same time show side by side.

/// A row of the folders table
export interface CloudFolder {
    folderId: string;
    name: string;
    createdBy: string | null;
    /// Milliseconds since the epoch
    createdAt: number;
    /// Milliseconds since the epoch
    updatedAt: number;
    /// Milliseconds since the epoch, null unless deleted
    deletedAt: number | null;
}

/// A folder with its workbooks
export interface CloudFolderNode {
    folder: CloudFolder;
    workbooks: CloudWorkbook[];
}

/// The folders and the workbooks at the top
export interface CloudTree {
    folders: CloudFolderNode[];
    workbooks: CloudWorkbook[];
}

export interface CloudFolderOptions extends CloudStoreOptions {
    /// Who creates the folder, the login of the cloud connection
    createdBy?: string;
}

function foldersTable(options: CloudStoreOptions): string {
    return cloudTable(CLOUD_FOLDERS_TABLE, options);
}

/// The order of names: natural, ignoring case
function compareNames(a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/// Build the tree of the folders that weren't deleted and the workbooks
export function buildCloudTree(folders: readonly CloudFolder[], workbooks: readonly CloudWorkbook[]): CloudTree {
    const nodes = new Map<string, CloudFolderNode>();
    for (const folder of folders) {
        if (folder.deletedAt == null) nodes.set(folder.folderId, { folder, workbooks: [] });
    }
    const tree: CloudTree = { folders: [...nodes.values()], workbooks: [] };
    for (const workbook of workbooks) {
        const node = workbook.folderId == null ? undefined : nodes.get(workbook.folderId);
        (node ?? tree).workbooks.push(workbook);
    }
    const byName = (a: CloudWorkbook, b: CloudWorkbook) => compareNames(a.name ?? '', b.name ?? '') || a.workbookId.localeCompare(b.workbookId);
    tree.folders.sort((a, b) => compareNames(a.folder.name, b.folder.name) || a.folder.folderId.localeCompare(b.folder.folderId));
    tree.workbooks.sort(byName);
    for (const node of tree.folders) node.workbooks.sort(byName);
    return tree;
}

/// Read the rows of the folders table, also the deleted ones
async function readFolders(query: CloudQuery, options: CloudStoreOptions): Promise<CloudFolder[]> {
    const table = await query(`SELECT CAST(folder_id AS text) AS folder_id, name, created_by, created_at, updated_at, deleted_at `
        + `FROM ${foldersTable(options)}`, options.signal);
    return [...table].map(row => ({
        folderId: String(row.folder_id),
        name: String(row.name),
        createdBy: row.created_by == null ? null : String(row.created_by),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
    }));
}

/// The folders and the workbooks that weren't deleted
export async function listCloudTree(query: CloudQuery, options: CloudStoreOptions = {}): Promise<CloudTree> {
    const view = await openCloudStore(query, 'read', options);
    if (!view.columns.has(CLOUD_FOLDERS_TABLE)) return { folders: [], workbooks: [] };
    const workbooks = await listCloudWorkbooks(query, options);
    return buildCloudTree(await readFolders(query, options), workbooks);
}

/// The folders that weren't deleted
async function liveFolders(query: CloudQuery, options: CloudStoreOptions): Promise<CloudFolder[]> {
    return (await readFolders(query, options)).filter(folder => folder.deletedAt == null);
}

/// Check the name of a folder, the names of folders differ ignoring case
function checkName(folders: readonly CloudFolder[], name: string, except?: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('A folder needs a name');
    if (folders.some(folder => folder.folderId !== except && folder.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error(`A folder ${trimmed} exists already`);
    }
    return trimmed;
}

/// Create a folder
export async function createCloudFolder(query: CloudQuery, name: string, options: CloudFolderOptions = {}): Promise<CloudFolder> {
    await openCloudStore(query, 'write', options);
    const checked = checkName(await liveFolders(query, options), name);
    const folderId = crypto.randomUUID();
    await query(`INSERT INTO ${foldersTable(options)} (folder_id, name, created_at, created_by, updated_at, deleted_at) `
        + `VALUES (${quoteLiteral(folderId)}, ${quoteLiteral(checked)}, now(), `
        + `${options.createdBy == null ? 'NULL' : quoteLiteral(options.createdBy)}, now(), NULL)`, options.signal);
    const created = (await readFolders(query, options)).find(folder => folder.folderId === folderId);
    if (created == null) throw new Error(`The folder ${checked} was not created`);
    return created;
}

/// Rename a folder
export async function renameCloudFolder(query: CloudQuery, folderId: string, name: string, options: CloudStoreOptions = {}): Promise<void> {
    checkCloudId(folderId, 'folder');
    await openCloudStore(query, 'write', options);
    const folders = await liveFolders(query, options);
    if (!folders.some(folder => folder.folderId === folderId)) throw new Error(`The cloud holds no folder ${folderId}`);
    const checked = checkName(folders, name, folderId);
    await query(`UPDATE ${foldersTable(options)} SET name = ${quoteLiteral(checked)}, updated_at = now() `
        + `WHERE folder_id = ${quoteLiteral(folderId)}`, options.signal);
}

/// Delete a folder. A single UPDATE marks it, its workbooks show at the top from then on.
export async function deleteCloudFolder(query: CloudQuery, folderId: string, options: CloudStoreOptions = {}): Promise<void> {
    checkCloudId(folderId, 'folder');
    await openCloudStore(query, 'write', options);
    await query(`UPDATE ${foldersTable(options)} SET deleted_at = now(), updated_at = now() `
        + `WHERE folder_id = ${quoteLiteral(folderId)} AND deleted_at IS NULL`, options.signal);
}

/// Move a workbook into a folder, to the top without one
export async function moveCloudWorkbook(query: CloudQuery, workbookId: string, folderId: string | null, options: CloudStoreOptions = {}): Promise<void> {
    checkCloudId(workbookId, 'workbook');
    if (folderId != null) checkCloudId(folderId, 'folder');
    await openCloudStore(query, 'write', options);
    if (folderId != null && !(await liveFolders(query, options)).some(folder => folder.folderId === folderId)) {
        throw new Error(`The cloud holds no folder ${folderId}`);
    }
    if (!(await listCloudWorkbooks(query, options)).some(workbook => workbook.workbookId === workbookId)) {
        throw new Error(`The cloud holds no workbook ${workbookId}`);
    }
    await query(`UPDATE ${cloudTable(CLOUD_WORKBOOKS_TABLE, options)} SET folder_id = ${folderId == null ? 'NULL' : quoteLiteral(folderId)}, `
        + `updated_at = now() WHERE workbook_id = ${quoteLiteral(workbookId)}`, options.signal);
}
