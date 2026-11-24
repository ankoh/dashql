import {cpSync, existsSync, renameSync, rmSync} from "node:fs";
import path from "node:path";

/// The user data folder of the app below the application data folder of the OS, e.g.
/// `~/Library/Application Support/DashQL`. The app pins it: Electron names the default folder after the package.
export const USER_DATA_FOLDER = "DashQL";

/// The user data folders of earlier versions below the application data folder, named after the npm package of the
/// app, oldest first
export const LEGACY_USER_DATA_FOLDERS: readonly string[] = ["@ankoh/dashql-electron", "@ankoh/dashql-native", "@akohn/dashql-native"];

/// The lock files of Chromium in a user data folder, they belong to the process that holds the folder
function isLockFile(name: string): boolean {
    return name.startsWith("Singleton") || name === "lockfile";
}

/// Copy the newest earlier user data folder to the user data folder if it doesn't exist yet, before anything uses it.
/// The whole folder comes along, the origin private file system and the folder grants with it, and the earlier
/// folders stay as a backup. Returns the folder that was copied, null if none was.
export function adoptLegacyUserData(appData: string, userData: string): string | null {
    if (existsSync(userData)) return null;
    const source = LEGACY_USER_DATA_FOLDERS.map(folder => path.join(appData, folder)).filter(folder => existsSync(folder)).at(-1);
    if (source === undefined) return null;
    // The copy lands under another name first, an interrupted copy is made again at the next start
    const partial = `${userData}.partial`;
    rmSync(partial, {recursive: true, force: true});
    cpSync(source, partial, {recursive: true, filter: (file) => !isLockFile(path.basename(file))});
    renameSync(partial, userData);
    return source;
}
