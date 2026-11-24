import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";

import {FolderGrants} from "./folder_grants.js";
import {
    copiedLegacyProfiles,
    exportLegacyProfiles,
    LEGACY_EXPORT_FOLDER,
    LEGACY_EXPORTED_MARKER,
    mergeLegacyFolderGrants,
    type ProfileStorage,
    removeLegacyProfile,
} from "./legacy_profiles.js";

/// An origin private file system in memory, as the hidden window of a profile reads it
function profileStorage(files: Record<string, string | Uint8Array>, dirs: string[] = []): ProfileStorage & {reads: number} {
    const bytes = (value: string | Uint8Array) => typeof value === "string" ? new TextEncoder().encode(value) : value;
    const storage = {
        reads: 0,
        list: async () => {
            const entries = new Map<string, boolean>();
            for (const dir of dirs) entries.set(dir, true);
            for (const file of Object.keys(files)) {
                const parts = file.split("/");
                for (let i = 1; i < parts.length; ++i) entries.set(parts.slice(0, i).join("/"), true);
                entries.set(file, false);
            }
            return [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([entry, directory]) => ({path: entry, directory}));
        },
        read: async (file: string, offset: number, length: number) => {
            storage.reads += 1;
            return bytes(files[file]!).slice(offset, offset + length);
        },
        close: async () => {},
    };
    return storage;
}

describe("legacy profiles", () => {
    let dir: string;
    let appData: string;
    let userData: string;
    const logs: string[] = [];
    const log = (message: string) => { logs.push(message); };
    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), "dashql-legacy-profiles-"));
        appData = path.join(dir, "Application Support");
        userData = path.join(appData, "DashQL");
        await mkdir(userData, {recursive: true});
        logs.length = 0;
    });
    afterEach(async () => {
        await rm(dir, {recursive: true, force: true});
    });

    it("copies the storage of the earlier folders oldest first and never again", async () => {
        await mkdir(path.join(appData, "@ankoh/dashql-native"), {recursive: true});
        await mkdir(path.join(appData, "@akohn/dashql-native"), {recursive: true});
        const storages: Record<string, ProfileStorage> = {
            [path.join(appData, "@ankoh/dashql-native")]: profileStorage({
                "dashql-manifest.json": "{}",
                "workbooks/w1/dashql-workbook.json": "{\"workbookId\":\"w1\"}",
                "workbooks/w1/attachments/a.parquet": new Uint8Array([0, 1, 2, 255]),
                "instances/i1/compute.hyper": "scratch",
                "exports/e1/x.parquet": "scratch",
            }, ["workbooktree/Empty"]),
            [path.join(appData, "@akohn/dashql-native")]: profileStorage({"dashql-manifest.json": "{\"storageVersion\":10}"}),
        };
        const opened: string[] = [];
        const open = async (folder: string) => { opened.push(folder); return storages[folder]!; };

        const profiles = await exportLegacyProfiles(appData, userData, open, log);
        expect(opened).toEqual([path.join(appData, "@ankoh/dashql-native"), path.join(appData, "@akohn/dashql-native")]);
        const copies = path.join(userData, LEGACY_EXPORT_FOLDER);
        expect(profiles).toEqual([
            {name: "ankoh-dashql-native", path: path.join(copies, "ankoh-dashql-native")},
            {name: "akohn-dashql-native", path: path.join(copies, "akohn-dashql-native")},
        ]);
        const copy = path.join(copies, "ankoh-dashql-native");
        expect(await readFile(path.join(copy, "workbooks/w1/dashql-workbook.json"), "utf8")).toBe("{\"workbookId\":\"w1\"}");
        expect([...await readFile(path.join(copy, "workbooks/w1/attachments/a.parquet"))]).toEqual([0, 1, 2, 255]);
        // Empty folders come along, the scratch space of windows and exports stays behind
        expect(await readdir(path.join(copy, "workbooktree/Empty"))).toEqual([]);
        expect((await readdir(copy)).sort()).toEqual(["dashql-manifest.json", "workbooks", "workbooktree"]);
        expect(JSON.parse(await readFile(path.join(appData, "@ankoh/dashql-native", LEGACY_EXPORTED_MARKER), "utf8")).target).toBe(userData);

        // A copied folder is never copied again, a merged copy goes
        expect(await removeLegacyProfile(userData, "ankoh-dashql-native")).toBe(true);
        opened.length = 0;
        expect(await exportLegacyProfiles(appData, userData, open, log)).toEqual([profiles[1]]);
        expect(opened).toEqual([]);
        expect(await removeLegacyProfile(userData, "../DashQL")).toBe(false);
    });

    it("copies a large file in chunks", async () => {
        await mkdir(path.join(appData, "@akohn/dashql-native"), {recursive: true});
        const large = new Uint8Array(16 * 1024 * 1024 + 3).map((_, i) => i % 251);
        const storage = profileStorage({"workbooks/w1/attachments/large.parquet": large});
        await exportLegacyProfiles(appData, userData, async () => storage, log);
        const copied = await readFile(path.join(userData, LEGACY_EXPORT_FOLDER, "akohn-dashql-native/workbooks/w1/attachments/large.parquet"));
        expect(copied.byteLength).toBe(large.byteLength);
        expect(Buffer.compare(copied, Buffer.from(large))).toBe(0);
        expect(storage.reads).toBe(2);
    });

    it("tries a copy that failed again at the next start", async () => {
        const source = path.join(appData, "@akohn/dashql-native");
        await mkdir(source, {recursive: true});
        const failing: ProfileStorage = {...profileStorage({"a.json": "{}"}), read: async () => { throw new Error("locked"); }};
        expect(await exportLegacyProfiles(appData, userData, async () => failing, log)).toEqual([]);
        expect(logs).toEqual(["Failed to copy the storage of an earlier profile"]);
        expect(await readdir(userData)).toEqual([LEGACY_EXPORT_FOLDER]);
        expect(await readdir(path.join(userData, LEGACY_EXPORT_FOLDER))).toEqual([]);

        const profiles = await exportLegacyProfiles(appData, userData, async () => profileStorage({"a.json": "{}"}), log);
        expect(profiles.map(profile => profile.name)).toEqual(["akohn-dashql-native"]);
        expect(await copiedLegacyProfiles(userData)).toEqual(profiles);
    });

    it("skips paths that would leave the copy", async () => {
        await mkdir(path.join(appData, "@akohn/dashql-native"), {recursive: true});
        const storage = profileStorage({"a.json": "{}"});
        storage.list = async () => [{path: "../escape", directory: false}, {path: "a.json", directory: false}];
        await exportLegacyProfiles(appData, userData, async () => storage, log);
        expect(await readdir(path.join(userData, LEGACY_EXPORT_FOLDER, "akohn-dashql-native"))).toEqual(["a.json"]);
        expect(await readdir(path.join(userData, LEGACY_EXPORT_FOLDER))).not.toContain("escape");
    });

    it("merges the folder grants of the earlier folders", async () => {
        const grants = path.join(userData, "folder-grants.json");
        await mergeLegacyFolderGrants(appData, grants, "folder-grants.json");
        // Without earlier grants the claims of the first start stay open
        await expect(readFile(grants)).rejects.toThrow();

        await mkdir(path.join(appData, "@ankoh/dashql-native"), {recursive: true});
        await mkdir(path.join(appData, "@akohn/dashql-native"), {recursive: true});
        await writeFile(path.join(appData, "@ankoh/dashql-native/folder-grants.json"), JSON.stringify(["/work/a", "/work/b"]));
        await writeFile(path.join(appData, "@akohn/dashql-native/folder-grants.json"), JSON.stringify(["/work/b", "/work/c", "relative"]));
        await mergeLegacyFolderGrants(appData, grants, "folder-grants.json");
        expect(JSON.parse(await readFile(grants, "utf8"))).toEqual(["/work/a", "/work/b", "/work/c"]);
        // The grants of the app stay and the merge repeats to the same
        await writeFile(grants, JSON.stringify(["/work/own"]));
        await mergeLegacyFolderGrants(appData, grants, "folder-grants.json");
        await mergeLegacyFolderGrants(appData, grants, "folder-grants.json");
        expect(JSON.parse(await readFile(grants, "utf8"))).toEqual(["/work/own", "/work/a", "/work/b", "/work/c"]);
    });

    it("grants the copies to the renderer while the app runs, without saving them", async () => {
        const file = path.join(userData, "folder-grants.json");
        const copies = path.join(userData, LEGACY_EXPORT_FOLDER);
        await mkdir(copies);
        const grants = await FolderGrants.load(file);
        expect(await grants.resolve(path.join(copies, "a/b.json"))).toBeNull();
        await grants.grantForSession(copies);
        expect(await grants.resolve(path.join(copies, "a/b.json"))).not.toBeNull();
        await expect(readFile(file)).rejects.toThrow();
    });
});
