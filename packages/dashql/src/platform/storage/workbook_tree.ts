import type * as app_folder from '@akohn/dashql-jsonschema/app_folder.js';

/// The folder of the workbook tree, it registers every workbook, e.g. `workbooktree/clients/acme/dashql-folder.json`
export const STORAGE_WORKBOOK_TREE_FOLDER = 'workbooktree';
/// The file of a folder of the workbook tree with the workbooks of the folder
export const STORAGE_FOLDER_FILE = 'dashql-folder.json';
/// The folder that a new storage starts with, the migration moves the workbooks of older storages into it
export const INITIAL_WORKBOOK_FOLDER: readonly string[] = ['My Workbooks'];

export type WorkbookEntry = app_folder.WorkbookEntry;
export type WorkbookFolderFile = app_folder.WorkbookFolder;

/// A folder of the workbook tree.
///
/// The directories of `workbooktree/` are the folders of the sidebar, the directory name is the folder name.
/// The subfolders come before the workbooks, in the natural order of their names, the workbooks keep the order
/// of their folder file.
export interface WorkbookTreeFolder {
    /// The folder name, empty for the root
    name: string;
    /// The folder names from the root, empty for the root
    path: string[];
    /// The subfolders, in the natural order of their names
    folders: WorkbookTreeFolder[];
    /// The workbooks of the folder, in the order of the sidebar
    workbooks: WorkbookEntry[];
}

/// The tree without folders and workbooks
export function emptyWorkbookTree(): WorkbookTreeFolder {
    return { name: '', path: [], folders: [], workbooks: [] };
}

/// Natural order of folder names (e.g. "q2" < "q10")
export function compareFolderNames(left: string, right: string): number {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

/// Are two folder paths the same?
export function sameFolderPath(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((name, index) => name === right[index]);
}

/// Is a folder path the path of a folder or of one of its subfolders?
export function isFolderPathWithin(path: readonly string[], ancestor: readonly string[]): boolean {
    return path.length >= ancestor.length && ancestor.every((name, index) => name === path[index]);
}

/// The workbooks of a tree in the order of the sidebar: the subfolders of a folder before its workbooks
export function flattenWorkbookTree(folder: WorkbookTreeFolder): WorkbookEntry[] {
    const entries: WorkbookEntry[] = [];
    const visit = (current: WorkbookTreeFolder) => {
        for (const child of current.folders) visit(child);
        entries.push(...current.workbooks);
    };
    visit(folder);
    return entries;
}

/// The folder at a path, null if there is none
export function folderAt(tree: WorkbookTreeFolder, path: readonly string[]): WorkbookTreeFolder | null {
    let current: WorkbookTreeFolder | undefined = tree;
    for (const name of path) {
        current = current.folders.find(folder => folder.name === name);
        if (current == null) return null;
    }
    return current;
}

/// The path of the folder that holds a workbook, null if the tree doesn't register it
export function findWorkbookFolder(tree: WorkbookTreeFolder, workbookId: string): string[] | null {
    if (tree.workbooks.some(entry => entry.path === workbookId)) return tree.path;
    for (const folder of tree.folders) {
        const path = findWorkbookFolder(folder, workbookId);
        if (path != null) return path;
    }
    return null;
}

/// Why a name can't name a new folder next to its siblings, null if it can.
/// The names are compared without case, so that folders stay apart on file systems that ignore it.
export function folderNameError(name: string, siblings: readonly string[]): string | null {
    if (name.length === 0) return 'The folder needs a name';
    if (name === '.' || name === '..' || /[/\\\0]/.test(name)) return `"${name}" is not a valid folder name`;
    const lower = name.toLowerCase();
    if (siblings.some(sibling => sibling.toLowerCase() === lower)) return `There is already a folder "${name}"`;
    return null;
}

/// Drop the later registrations of workbooks that the tree registers twice, the first one in tree order wins.
/// A folder move that is interrupted between its copy and its delete leaves such duplicates.
export function dropDuplicateWorkbooks(tree: WorkbookTreeFolder): WorkbookTreeFolder {
    const seen = new Set<string>();
    const visit = (folder: WorkbookTreeFolder): WorkbookTreeFolder => {
        const folders = folder.folders.map(visit);
        const workbooks = folder.workbooks.filter(entry => {
            if (seen.has(entry.path)) return false;
            seen.add(entry.path);
            return true;
        });
        return { ...folder, folders, workbooks };
    };
    return visit(tree);
}

/// Replace the folder at a path, the folders on the way are copied
function replaceFolder(tree: WorkbookTreeFolder, path: readonly string[], replace: (folder: WorkbookTreeFolder) => WorkbookTreeFolder): WorkbookTreeFolder {
    if (path.length === 0) return replace(tree);
    const [head, ...rest] = path;
    return {
        ...tree,
        folders: tree.folders.map(folder => folder.name === head ? replaceFolder(folder, rest, replace) : folder),
    };
}

/// Remove a workbook from every folder of the tree
export function removeWorkbookFromTree(tree: WorkbookTreeFolder, workbookId: string): WorkbookTreeFolder {
    const visit = (folder: WorkbookTreeFolder): WorkbookTreeFolder => ({
        ...folder,
        folders: folder.folders.map(visit),
        workbooks: folder.workbooks.filter(entry => entry.path !== workbookId),
    });
    return visit(tree);
}

/// Insert or replace the entry of a workbook.
/// A registered workbook keeps its place, a new one is appended to the folder at `folderPath`, or to the root
/// if there is no such folder.
export function upsertWorkbookInTree(tree: WorkbookTreeFolder, entry: WorkbookEntry, folderPath: readonly string[] = []): WorkbookTreeFolder {
    const current = findWorkbookFolder(tree, entry.path);
    if (current != null) {
        return replaceFolder(tree, current, folder => ({
            ...folder,
            workbooks: folder.workbooks.map(existing => existing.path === entry.path ? entry : existing),
        }));
    }
    const target = folderAt(tree, folderPath) != null ? folderPath : [];
    return replaceFolder(tree, target, folder => ({ ...folder, workbooks: [...folder.workbooks, entry] }));
}

/// Move a workbook to a position in a folder. The index counts the workbooks of the target folder without the
/// moved workbook, an index past the end appends. A workbook that the tree doesn't register yet is placed as an
/// OPFS workbook, e.g. a new workbook that is created in a folder before its first write registers it.
/// Returns the tree unchanged if there is no folder at the path.
export function moveWorkbookInTree(tree: WorkbookTreeFolder, workbookId: string, folderPath: readonly string[], index: number): WorkbookTreeFolder {
    if (folderAt(tree, folderPath) == null) return tree;
    const from = findWorkbookFolder(tree, workbookId);
    const entry = from == null
        ? { path: workbookId }
        : folderAt(tree, from)!.workbooks.find(workbook => workbook.path === workbookId)!;
    const removed = removeWorkbookFromTree(tree, workbookId);
    return replaceFolder(removed, folderPath, folder => {
        const workbooks = [...folder.workbooks];
        workbooks.splice(Math.max(0, Math.min(index, workbooks.length)), 0, entry);
        return { ...folder, workbooks };
    });
}

/// Every folder of a tree with its path, the root included
export function listFolders(tree: WorkbookTreeFolder): WorkbookTreeFolder[] {
    const folders: WorkbookTreeFolder[] = [];
    const visit = (folder: WorkbookTreeFolder) => {
        folders.push(folder);
        for (const child of folder.folders) visit(child);
    };
    visit(tree);
    return folders;
}

/// The key of a folder path, e.g. for maps of folders
export function folderPathKey(path: readonly string[]): string {
    return JSON.stringify(path);
}

/// Read the workbook tree below a directory, `workbooktree/` of the OPFS root.
/// A directory without a folder file is a folder without workbooks, entries without a workbook id are skipped.
export async function readWorkbookTreeDirectory(dir: FileSystemDirectoryHandle, path: string[] = []): Promise<WorkbookTreeFolder> {
    const folders: WorkbookTreeFolder[] = [];
    let workbooks: WorkbookEntry[] = [];
    for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') {
            folders.push(await readWorkbookTreeDirectory(handle as FileSystemDirectoryHandle, [...path, name]));
        } else if (name === STORAGE_FOLDER_FILE) {
            workbooks = parseWorkbookFolderFile(await (await (handle as FileSystemFileHandle).getFile()).text(), path);
        }
    }
    folders.sort((left, right) => compareFolderNames(left.name, right.name));
    return { name: path[path.length - 1] ?? '', path, folders, workbooks };
}

/// Read the workbook tree of a storage root, the empty tree if it has none
export async function readWorkbookTree(root: FileSystemDirectoryHandle): Promise<WorkbookTreeFolder> {
    let dir: FileSystemDirectoryHandle;
    try {
        dir = await root.getDirectoryHandle(STORAGE_WORKBOOK_TREE_FOLDER, { create: false });
    } catch (error) {
        if ((error as DOMException).name === 'NotFoundError') return emptyWorkbookTree();
        throw error;
    }
    return dropDuplicateWorkbooks(await readWorkbookTreeDirectory(dir));
}

/// Parse a folder file
function parseWorkbookFolderFile(text: string, path: readonly string[]): WorkbookEntry[] {
    const data: unknown = JSON.parse(text);
    const workbooks = (data as Partial<WorkbookFolderFile> | null)?.workbooks;
    if (!Array.isArray(workbooks)) {
        throw new Error(`Invalid ${STORAGE_WORKBOOK_TREE_FOLDER}/${[...path, STORAGE_FOLDER_FILE].join('/')}: workbooks must be an array`);
    }
    return workbooks.filter((entry): entry is WorkbookEntry => typeof entry?.path === 'string' && entry.path.length > 0);
}

/// A free name for a new folder next to its siblings: "New folder", "New folder 2", …
export function freeFolderName(siblings: readonly string[]): string {
    const taken = new Set(siblings.map(name => name.toLowerCase()));
    if (!taken.has('new folder')) return 'New folder';
    let n = 2;
    while (taken.has(`new folder ${n}`)) ++n;
    return `New folder ${n}`;
}
