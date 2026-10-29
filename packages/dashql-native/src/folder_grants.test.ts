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
        const session = path.join(dir, "session");
        await mkdir(path.join(session, "scripts"), {recursive: true});
        const grants = await FolderGrants.load(file);
        expect(await grants.resolve(path.join(session, "scripts", "1.sql"))).toBeNull();
        await grants.grant(session);

        expect(await grants.resolve(path.join(session, "scripts", "1.sql"))).toBe(path.join(await realDir(session), "scripts", "1.sql"));
        expect(await grants.resolve(path.join(session, "new", "folder", "file"))).not.toBeNull();
        expect(await grants.resolve(session)).not.toBeNull();
        expect(await grants.resolve(path.join(session, "..", "folder-grants.json"))).toBeNull();
        expect(await grants.resolve(`${session}-sibling/file`)).toBeNull();
        expect(await grants.resolve("/etc/passwd")).toBeNull();
        expect(grants.isRoot((await grants.resolve(session))!)).toBe(true);
    });

    it("does not follow links out of a granted folder", async () => {
        const session = path.join(dir, "session");
        const outside = path.join(dir, "outside");
        await mkdir(session);
        await mkdir(outside);
        await symlink(outside, path.join(session, "link"));
        await symlink(path.join(outside, "missing"), path.join(session, "dangling"));
        const grants = await FolderGrants.load(file);
        await grants.grant(session);
        expect(await grants.resolve(path.join(session, "link", "file"))).toBeNull();
        await expect(grants.resolve(path.join(session, "dangling"))).rejects.toThrow("dangling");
    });

    it("keeps the grants across starts", async () => {
        const session = path.join(dir, "session");
        await mkdir(session);
        await (await FolderGrants.load(file)).grant(session);
        expect(JSON.parse(await readFile(file, "utf8"))).toEqual([await realDir(session)]);
        const reloaded = await FolderGrants.load(file);
        expect(await reloaded.resolve(path.join(session, "file"))).not.toBeNull();
    });

    it("accepts claims of session folders only on the first start", async () => {
        const session = path.join(dir, "session");
        const legacy = path.join(dir, "legacy");
        const home = path.join(dir, "home");
        await mkdir(session);
        await mkdir(legacy);
        await mkdir(home);
        await writeFile(path.join(session, "dashql-session.json"), "{}");
        await writeFile(path.join(legacy, "dashql-notebook.json"), "{}");

        const first = await FolderGrants.load(file);
        expect(await first.claimSessionFolder(home)).toBe(false);
        expect(await first.claimSessionFolder(path.join(dir, "missing"))).toBe(false);
        expect(await first.claimSessionFolder(session)).toBe(true);
        expect(await first.claimSessionFolder(legacy)).toBe(true);
        expect(await first.resolve(path.join(home, "file"))).toBeNull();
        expect(await first.resolve(path.join(legacy, "file"))).not.toBeNull();

        const second = await FolderGrants.load(file);
        const other = path.join(dir, "other");
        await mkdir(other);
        await writeFile(path.join(other, "dashql-session.json"), "{}");
        expect(await second.claimSessionFolder(other)).toBe(false);
        expect(await second.resolve(path.join(session, "file"))).not.toBeNull();
    });
});

async function realDir(folder: string): Promise<string> {
    return await realpath(folder);
}
