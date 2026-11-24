import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";

import {adoptLegacyUserData, USER_DATA_FOLDER} from "./legacy_user_data.js";

describe("legacy user data", () => {
    let appData: string;
    let userData: string;
    beforeEach(async () => {
        appData = await mkdtemp(path.join(tmpdir(), "dashql-legacy-user-data-"));
        userData = path.join(appData, USER_DATA_FOLDER);
    });
    afterEach(async () => {
        await rm(appData, {recursive: true, force: true});
    });

    it("copies the newest earlier folder without its locks", async () => {
        const older = path.join(appData, "@ankoh/dashql-native");
        const newer = path.join(appData, "@akohn/dashql-native");
        await mkdir(path.join(older, "File System"), {recursive: true});
        await writeFile(path.join(older, "folder-grants.json"), "[\"/old\"]");
        await mkdir(path.join(newer, "File System/000/t"), {recursive: true});
        await writeFile(path.join(newer, "File System/000/t/00000000"), "opfs");
        await writeFile(path.join(newer, "folder-grants.json"), "[\"/new\"]");
        await writeFile(path.join(newer, "SingletonLock"), "host-1");

        expect(adoptLegacyUserData(appData, userData)).toBe(newer);
        expect(await readFile(path.join(userData, "File System/000/t/00000000"), "utf8")).toBe("opfs");
        expect(await readFile(path.join(userData, "folder-grants.json"), "utf8")).toBe("[\"/new\"]");
        expect((await readdir(userData)).sort()).toEqual(["File System", "folder-grants.json"]);
        // The earlier folders stay, the copy happens once
        expect(await readdir(newer)).toContain("SingletonLock");
        expect(adoptLegacyUserData(appData, userData)).toBeNull();
    });

    it("replaces an interrupted copy", async () => {
        await mkdir(path.join(appData, "@ankoh/dashql-electron"), {recursive: true});
        await writeFile(path.join(appData, "@ankoh/dashql-electron/a.json"), "{}");
        await mkdir(`${userData}.partial`);
        await writeFile(`${userData}.partial/stale.json`, "{}");
        expect(adoptLegacyUserData(appData, userData)).toBe(path.join(appData, "@ankoh/dashql-electron"));
        expect(await readdir(userData)).toEqual(["a.json"]);
        expect(await readdir(appData)).not.toContain(`${USER_DATA_FOLDER}.partial`);
    });

    it("copies nothing without an earlier folder", () => {
        expect(adoptLegacyUserData(appData, userData)).toBeNull();
    });
});
