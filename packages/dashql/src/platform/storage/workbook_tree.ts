import type * as app_folder from '@akohn/dashql-jsonschema/app_folder.js';
import type * as core from '../../core/index.js';
import { readFileText } from '../opfs_root.js';

// The workbook tree: the folders of the sidebar in `workbooktree/`, every directory a folder with a `dashql-folder.json`
// that lists its workbooks. The core builds the tree of the folder files and decides how a change of its workbooks
// changes them (`workbook_format/tree.rs` of the core storage), the platform lists the directories and writes the
// files. The functions here only read a tree that the core built.

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

/// A directory of `workbooktree/` as the platform lists it, with the text of its folder file
export interface WorkbookTreeDirectory {
    name: string;
    /// The text of its `dashql-folder.json`, null if it has none
    folderFile: string | null;
    directories: WorkbookTreeDirectory[];
}

/// A change of the workbooks of the tree: insert or replace the entry of a workbook, a registered one keeps its place
/// and a new one goes to the end of the folder at `folderPath` or of the root; remove a workbook; or move it to a
/// position in a folder, counted without the moved workbook
export type WorkbookTreeChange =
    | { kind: 'upsert'; entry: WorkbookEntry; folderPath?: readonly string[] }
    | { kind: 'remove'; workbookId: string }
    | { kind: 'move'; workbookId: string; folderPath: readonly string[]; index: number };

/// A folder file that a change of the tree writes, the folder is created when missing
export interface FolderFileWrite {
    path: string[];
    text: string;
}

/// The tree without folders and workbooks
export function emptyWorkbookTree(): WorkbookTreeFolder {
    return { name: '', path: [], folders: [], workbooks: [] };
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

/// Change the workbooks of a tree as it is stored, duplicates included: the tree after the change and the folder files
/// to write in their order, the folders that gain workbooks first. A move into a folder that doesn't exist throws.
export function changeWorkbookTree(instance: core.DashQL, stored: WorkbookTreeFolder, change: WorkbookTreeChange): { tree: WorkbookTreeFolder; writes: FolderFileWrite[] } {
    return instance.changeWorkbookTree<WorkbookTreeFolder>(stored, change);
}

/// The tree after a change of its workbooks, see `changeWorkbookTree`
export function applyWorkbookTreeChange(instance: core.DashQL, tree: WorkbookTreeFolder, change: WorkbookTreeChange): WorkbookTreeFolder {
    return changeWorkbookTree(instance, tree, change).tree;
}

/// List the directories of `workbooktree/` below a directory with the texts of their folder files
export async function listWorkbookTreeDirectory(dir: FileSystemDirectoryHandle, name: string = ''): Promise<WorkbookTreeDirectory> {
    const listed: WorkbookTreeDirectory = { name, folderFile: null, directories: [] };
    for await (const [entry, handle] of dir.entries()) {
        if (handle.kind === 'directory') {
            listed.directories.push(await listWorkbookTreeDirectory(handle as FileSystemDirectoryHandle, entry));
        } else if (entry === STORAGE_FOLDER_FILE) {
            listed.folderFile = await readFileText(handle as FileSystemFileHandle);
        }
    }
    return listed;
}

/// Read the workbook tree of a storage root, the empty tree if it has none. A workbook that the tree registers twice is
/// listed where it comes first.
export async function readWorkbookTree(instance: core.DashQL, root: FileSystemDirectoryHandle): Promise<WorkbookTreeFolder> {
    let dir: FileSystemDirectoryHandle;
    try {
        dir = await root.getDirectoryHandle(STORAGE_WORKBOOK_TREE_FOLDER, { create: false });
    } catch (error) {
        if ((error as DOMException).name === 'NotFoundError') return emptyWorkbookTree();
        throw error;
    }
    return instance.readWorkbookTree<WorkbookTreeFolder>(await listWorkbookTreeDirectory(dir));
}
