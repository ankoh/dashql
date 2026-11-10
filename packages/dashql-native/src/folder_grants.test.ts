import {mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";

import {FolderGrants} from "./folder_grants.js";

describe("FolderGrants", () => {
    let dir: string;
    let file: string;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), "dashql-folder-grants-"));
        file = path.join(dir, "folder-grants.json");
    });
    afterEach(async () => {
        await rm(dir, {recursive: true, force: true});
    });

    it("resolves only paths in granted folders", async () => {
        const workbook = path.join(dir, "workbook");
        await mkdir(path.join(workbook, "scripts"), {recursive: true});
        const grants = await FolderGrants.load(file);
        expect(await grants.resolve(path.join(workbook, "scripts", "1.sql"))).toBeNull();
        await grants.grant(workbook);

        expect(await grants.resolve(path.join(workbook, "scripts", "1.sql"))).toBe(path.join(await realDir(workbook), "scripts", "1.sql"));
        expect(await grants.resolve(path.join(workbook, "new", "folder", "file"))).not.toBeNull();
        expect(await grants.resolve(workbook)).not.toBeNull();
        expect(await grants.resolve(path.join(workbook, "..", "folder-grants.json"))).toBeNull();
        expect(await grants.resolve(`${workbook}-sibling/file`)).toBeNull();
        expect(await grants.resolve("/etc/passwd")).toBeNull();
        expect(grants.isRoot((await grants.resolve(workbook))!)).toBe(true);
    });

    it("does not follow links out of a granted folder", async () => {
        const workbook = path.join(dir, "workbook");
        const outside = path.join(dir, "outside");
        await mkdir(workbook);
        await mkdir(outside);
        await symlink(outside, path.join(workbook, "link"));
        await symlink(path.join(outside, "missing"), path.join(workbook, "dangling"));
        const grants = await FolderGrants.load(file);
        await grants.grant(workbook);
        expect(await grants.resolve(path.join(workbook, "link", "file"))).toBeNull();
        await expect(grants.resolve(path.join(workbook, "dangling"))).rejects.toThrow("dangling");
    });

    it("keeps the grants across starts", async () => {
        const workbook = path.join(dir, "workbook");
        await mkdir(workbook);
        await (await FolderGrants.load(file)).grant(workbook);
        expect(JSON.parse(await readFile(file, "utf8"))).toEqual([await realDir(workbook)]);
        const reloaded = await FolderGrants.load(file);
        expect(await reloaded.resolve(path.join(workbook, "file"))).not.toBeNull();
    });

    it("accepts claims of workbook folders only on the first start", async () => {
        const workbook = path.join(dir, "workbook");
        const legacy = path.join(dir, "legacy");
        const home = path.join(dir, "home");
        await mkdir(workbook);
        await mkdir(legacy);
        await mkdir(home);
        await writeFile(path.join(workbook, "dashql-workbook.json"), "{}");
        await writeFile(path.join(legacy, "dashql-notebook.json"), "{}");

        const first = await FolderGrants.load(file);
        expect(await first.claimWorkbookFolder(home)).toBe(false);
        expect(await first.claimWorkbookFolder(path.join(dir, "missing"))).toBe(false);
        expect(await first.claimWorkbookFolder(workbook)).toBe(true);
        expect(await first.claimWorkbookFolder(legacy)).toBe(true);
        expect(await first.resolve(path.join(home, "file"))).toBeNull();
        expect(await first.resolve(path.join(legacy, "file"))).not.toBeNull();

        const second = await FolderGrants.load(file);
        const other = path.join(dir, "other");
        await mkdir(other);
        await writeFile(path.join(other, "dashql-workbook.json"), "{}");
        expect(await second.claimWorkbookFolder(other)).toBe(false);
        expect(await second.resolve(path.join(workbook, "file"))).not.toBeNull();
    });
});

async function realDir(folder: string): Promise<string> {
    return await realpath(folder);
}
