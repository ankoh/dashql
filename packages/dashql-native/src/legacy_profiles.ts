import {access, mkdir, open, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";

/// The user data folder of the app below the application data folder of the OS, e.g.
/// `~/Library/Application Support/DashQL`. The app pins it: Electron names the default folder after the package.
export const USER_DATA_FOLDER = "DashQL";

/// The user data folders of earlier versions below the application data folder, named after the npm package of the
/// app, oldest first. Their storage merges into the pinned folder in this order, what merged first wins.
export const LEGACY_USER_DATA_FOLDERS: readonly string[] = ["@ankoh/dashql-electron", "@ankoh/dashql-native", "@akohn/dashql-native"];

/// The folder in the user data folder that holds the storage copied out of the earlier user data folders
export const LEGACY_EXPORT_FOLDER = "legacy-profiles";

/// The file in an earlier user data folder that says its storage was copied out, it is never copied again
export const LEGACY_EXPORTED_MARKER = "dashql-exported.json";

/// The top-level folders of an origin private file system that are scratch space of one window or one export
/// (docs/design/storage_layout.md), they stay behind
const TRANSIENT_FOLDERS = new Set(["instances", "exports"]);

/// The bytes of a file are copied in chunks of this size
const CHUNK_BYTES = 16 * 1024 * 1024;

/// The origin private file system of an earlier profile, as the main process reads it
export interface ProfileStorage {
    /// The files and directories, by their paths with `/`, parents before their children
    list(): Promise<Array<{path: string; directory: boolean}>>;
    /// A part of a file, shorter than asked at its end
    read(file: string, offset: number, length: number): Promise<Uint8Array>;
    close(): Promise<void>;
}

/// A copied profile that the renderer merges: the name it merges under and the folder of its files
export interface LegacyProfile {
    name: string;
    path: string;
}

/// The name of the copy of an earlier user data folder, a single folder name, e.g. `ankoh-dashql-native`
export function legacyProfileName(folder: string): string {
    return folder.replace(/^@/, "").replaceAll("/", "-");
}

/// The relative path of an entry of a profile below its copy, null for a path that would leave it or is no path
function relativePath(entry: string): string | null {
    const parts = entry.split("/");
    if (parts.some(part => part === "" || part === "." || part === ".." || part.includes("\\") || part.includes("\0"))) return null;
    return parts.join(path.sep);
}

async function exists(file: string): Promise<boolean> {
    return await access(file).then(() => true, () => false);
}

/// Merge the folder grants of the earlier user data folders into the grants of the app, so that the native workbooks
/// they registered stay reachable. Nothing is written when no earlier folder has grants.
export async function mergeLegacyFolderGrants(appData: string, grantsFile: string, fileName: string): Promise<void> {
    const roots: string[] = [];
    let found = false;
    for (const file of [grantsFile, ...LEGACY_USER_DATA_FOLDERS.map(folder => path.join(appData, folder, fileName))]) {
        let text: string;
        try {
            text = await readFile(file, "utf8");
        } catch {
            continue;
        }
        if (file !== grantsFile) found = true;
        const parsed = JSON.parse(text) as unknown;
        for (const root of Array.isArray(parsed) ? parsed : []) {
            if (typeof root === "string" && path.isAbsolute(root) && !roots.includes(root)) roots.push(root);
        }
    }
    if (!found) return;
    await mkdir(path.dirname(grantsFile), {recursive: true});
    await writeFile(grantsFile, JSON.stringify(roots, null, 2));
}

/// Copy the origin private file system of every earlier user data folder into the user data folder, oldest first. A
/// folder that was copied before is skipped, a copy that fails is removed and tried again at the next start. Returns
/// the profiles that were copied and not merged yet.
export async function exportLegacyProfiles(
    appData: string,
    userData: string,
    openProfile: (folder: string) => Promise<ProfileStorage>,
    log: (message: string, details: Record<string, string>) => void,
): Promise<LegacyProfile[]> {
    for (const folder of LEGACY_USER_DATA_FOLDERS) {
        const source = path.join(appData, folder);
        if (!(await exists(source)) || await exists(path.join(source, LEGACY_EXPORTED_MARKER))) continue;
        const name = legacyProfileName(folder);
        const target = path.join(userData, LEGACY_EXPORT_FOLDER, name);
        try {
            await rm(`${target}.json`, {force: true});
            await rm(target, {recursive: true, force: true});
            await mkdir(target, {recursive: true});
            const storage = await openProfile(source);
            let files = 0;
            try {
                for (const entry of await storage.list()) {
                    const relative = relativePath(entry.path);
                    if (relative === null || TRANSIENT_FOLDERS.has(entry.path.split("/")[0]!)) continue;
                    const file = path.join(target, relative);
                    if (entry.directory) {
                        await mkdir(file, {recursive: true});
                        continue;
                    }
                    await mkdir(path.dirname(file), {recursive: true});
                    const handle = await open(file, "w");
                    try {
                        for (let offset = 0; ; offset += CHUNK_BYTES) {
                            const chunk = await storage.read(entry.path, offset, CHUNK_BYTES);
                            await handle.write(chunk);
                            if (chunk.byteLength < CHUNK_BYTES) break;
                        }
                    } finally {
                        await handle.close();
                    }
                    files += 1;
                }
            } finally {
                await storage.close();
            }
            // The copy is complete, the earlier folder is never copied again
            const exportedAt = new Date().toISOString();
            await writeFile(`${target}.json`, JSON.stringify({source, exportedAt}, null, 2));
            await writeFile(path.join(source, LEGACY_EXPORTED_MARKER), JSON.stringify({target: userData, exportedAt}, null, 2));
            log("Copied the storage of an earlier profile", {source, files: String(files)});
        } catch (error) {
            log("Failed to copy the storage of an earlier profile", {source, error: error instanceof Error ? error.message : String(error)});
            await rm(target, {recursive: true, force: true}).catch(() => {});
        }
    }
    return await copiedLegacyProfiles(userData);
}

/// The copies of earlier profiles that are complete and not merged yet, oldest first
export async function copiedLegacyProfiles(userData: string): Promise<LegacyProfile[]> {
    const profiles: LegacyProfile[] = [];
    for (const folder of LEGACY_USER_DATA_FOLDERS) {
        const name = legacyProfileName(folder);
        const copy = path.join(userData, LEGACY_EXPORT_FOLDER, name);
        if (await exists(`${copy}.json`) && await exists(copy)) profiles.push({name, path: copy});
    }
    return profiles;
}

/// Remove the copy of an earlier profile once it merged. Returns false for a name that is no earlier profile.
export async function removeLegacyProfile(userData: string, name: string): Promise<boolean> {
    if (!LEGACY_USER_DATA_FOLDERS.some(folder => legacyProfileName(folder) === name)) return false;
    const copy = path.join(userData, LEGACY_EXPORT_FOLDER, name);
    // The folder first: a copy without its folder is never listed
    await rm(copy, {recursive: true, force: true});
    await rm(`${copy}.json`, {force: true});
    return true;
}
