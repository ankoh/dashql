import type * as app_folder from '@ankoh/dashql-jsonschema/app_folder.js';

/// The folder of the session tree, it registers every session, e.g. `sessiontree/clients/acme/dashql-folder.json`
export const STORAGE_SESSION_TREE_FOLDER = 'sessiontree';
/// The file of a folder of the session tree with the sessions of the folder
export const STORAGE_FOLDER_FILE = 'dashql-folder.json';
/// The folder that a new storage starts with, the migration moves the sessions of older storages into it
export const INITIAL_SESSION_FOLDER: readonly string[] = ['My Sessions'];

export type SessionEntry = app_folder.SessionEntry;
export type SessionFolderFile = app_folder.SessionFolder;

/// A folder of the session tree.
///
/// The directories of `sessiontree/` are the folders of the sidebar, the directory name is the folder name.
/// The subfolders come before the sessions, in the natural order of their names, the sessions keep the order
/// of their folder file.
export interface SessionTreeFolder {
    /// The folder name, empty for the root
    name: string;
    /// The folder names from the root, empty for the root
    path: string[];
    /// The subfolders, in the natural order of their names
    folders: SessionTreeFolder[];
    /// The sessions of the folder, in the order of the sidebar
    sessions: SessionEntry[];
}

/// The tree without folders and sessions
export function emptySessionTree(): SessionTreeFolder {
    return { name: '', path: [], folders: [], sessions: [] };
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

/// The sessions of a tree in the order of the sidebar: the subfolders of a folder before its sessions
export function flattenSessionTree(folder: SessionTreeFolder): SessionEntry[] {
    const entries: SessionEntry[] = [];
    const visit = (current: SessionTreeFolder) => {
        for (const child of current.folders) visit(child);
        entries.push(...current.sessions);
    };
    visit(folder);
    return entries;
}

/// The folder at a path, null if there is none
export function folderAt(tree: SessionTreeFolder, path: readonly string[]): SessionTreeFolder | null {
    let current: SessionTreeFolder | undefined = tree;
    for (const name of path) {
        current = current.folders.find(folder => folder.name === name);
        if (current == null) return null;
    }
    return current;
}

/// The path of the folder that holds a session, null if the tree doesn't register it
export function findSessionFolder(tree: SessionTreeFolder, sessionId: string): string[] | null {
    if (tree.sessions.some(entry => entry.path === sessionId)) return tree.path;
    for (const folder of tree.folders) {
        const path = findSessionFolder(folder, sessionId);
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

/// Drop the later registrations of sessions that the tree registers twice, the first one in tree order wins.
/// A folder move that is interrupted between its copy and its delete leaves such duplicates.
export function dropDuplicateSessions(tree: SessionTreeFolder): SessionTreeFolder {
    const seen = new Set<string>();
    const visit = (folder: SessionTreeFolder): SessionTreeFolder => {
        const folders = folder.folders.map(visit);
        const sessions = folder.sessions.filter(entry => {
            if (seen.has(entry.path)) return false;
            seen.add(entry.path);
            return true;
        });
        return { ...folder, folders, sessions };
    };
    return visit(tree);
}

/// Replace the folder at a path, the folders on the way are copied
function replaceFolder(tree: SessionTreeFolder, path: readonly string[], replace: (folder: SessionTreeFolder) => SessionTreeFolder): SessionTreeFolder {
    if (path.length === 0) return replace(tree);
    const [head, ...rest] = path;
    return {
        ...tree,
        folders: tree.folders.map(folder => folder.name === head ? replaceFolder(folder, rest, replace) : folder),
    };
}

/// Remove a session from every folder of the tree
export function removeSessionFromTree(tree: SessionTreeFolder, sessionId: string): SessionTreeFolder {
    const visit = (folder: SessionTreeFolder): SessionTreeFolder => ({
        ...folder,
        folders: folder.folders.map(visit),
        sessions: folder.sessions.filter(entry => entry.path !== sessionId),
    });
    return visit(tree);
}

/// Insert or replace the entry of a session.
/// A registered session keeps its place, a new one is appended to the folder at `folderPath`, or to the root
/// if there is no such folder.
export function upsertSessionInTree(tree: SessionTreeFolder, entry: SessionEntry, folderPath: readonly string[] = []): SessionTreeFolder {
    const current = findSessionFolder(tree, entry.path);
    if (current != null) {
        return replaceFolder(tree, current, folder => ({
            ...folder,
            sessions: folder.sessions.map(existing => existing.path === entry.path ? entry : existing),
        }));
    }
    const target = folderAt(tree, folderPath) != null ? folderPath : [];
    return replaceFolder(tree, target, folder => ({ ...folder, sessions: [...folder.sessions, entry] }));
}

/// Move a session to a position in a folder. The index counts the sessions of the target folder without the
/// moved session, an index past the end appends. A session that the tree doesn't register yet is placed as an
/// OPFS session, e.g. a new session that is created in a folder before its first write registers it.
/// Returns the tree unchanged if there is no folder at the path.
export function moveSessionInTree(tree: SessionTreeFolder, sessionId: string, folderPath: readonly string[], index: number): SessionTreeFolder {
    if (folderAt(tree, folderPath) == null) return tree;
    const from = findSessionFolder(tree, sessionId);
    const entry = from == null
        ? { path: sessionId }
        : folderAt(tree, from)!.sessions.find(session => session.path === sessionId)!;
    const removed = removeSessionFromTree(tree, sessionId);
    return replaceFolder(removed, folderPath, folder => {
        const sessions = [...folder.sessions];
        sessions.splice(Math.max(0, Math.min(index, sessions.length)), 0, entry);
        return { ...folder, sessions };
    });
}

/// Every folder of a tree with its path, the root included
export function listFolders(tree: SessionTreeFolder): SessionTreeFolder[] {
    const folders: SessionTreeFolder[] = [];
    const visit = (folder: SessionTreeFolder) => {
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

/// Read the session tree below a directory, `sessiontree/` of the OPFS root.
/// A directory without a folder file is a folder without sessions, entries without a session id are skipped.
export async function readSessionTreeDirectory(dir: FileSystemDirectoryHandle, path: string[] = []): Promise<SessionTreeFolder> {
    const folders: SessionTreeFolder[] = [];
    let sessions: SessionEntry[] = [];
    for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') {
            folders.push(await readSessionTreeDirectory(handle as FileSystemDirectoryHandle, [...path, name]));
        } else if (name === STORAGE_FOLDER_FILE) {
            sessions = parseSessionFolderFile(await (await (handle as FileSystemFileHandle).getFile()).text(), path);
        }
    }
    folders.sort((left, right) => compareFolderNames(left.name, right.name));
    return { name: path[path.length - 1] ?? '', path, folders, sessions };
}

/// Read the session tree of a storage root, the empty tree if it has none
export async function readSessionTree(root: FileSystemDirectoryHandle): Promise<SessionTreeFolder> {
    let dir: FileSystemDirectoryHandle;
    try {
        dir = await root.getDirectoryHandle(STORAGE_SESSION_TREE_FOLDER, { create: false });
    } catch (error) {
        if ((error as DOMException).name === 'NotFoundError') return emptySessionTree();
        throw error;
    }
    return dropDuplicateSessions(await readSessionTreeDirectory(dir));
}

/// Parse a folder file
function parseSessionFolderFile(text: string, path: readonly string[]): SessionEntry[] {
    const data: unknown = JSON.parse(text);
    const sessions = (data as Partial<SessionFolderFile> | null)?.sessions;
    if (!Array.isArray(sessions)) {
        throw new Error(`Invalid ${STORAGE_SESSION_TREE_FOLDER}/${[...path, STORAGE_FOLDER_FILE].join('/')}: sessions must be an array`);
    }
    return sessions.filter((entry): entry is SessionEntry => typeof entry?.path === 'string' && entry.path.length > 0);
}

/// A free name for a new folder next to its siblings: "New folder", "New folder 2", …
export function freeFolderName(siblings: readonly string[]): string {
    const taken = new Set(siblings.map(name => name.toLowerCase()));
    if (!taken.has('new folder')) return 'New folder';
    let n = 2;
    while (taken.has(`new folder ${n}`)) ++n;
    return `New folder ${n}`;
}
