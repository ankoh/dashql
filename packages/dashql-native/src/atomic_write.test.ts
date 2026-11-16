import {mkdtemp, readdir, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

import {afterEach, beforeEach, describe, expect, it} from "vitest";

import {writeFileAtomically} from "./atomic_write.js";

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(path.join(process.env.TEST_TMPDIR ?? tmpdir(), "dashql-atomic-"));
});

afterEach(async () => {
    await rm(dir, {recursive: true, force: true});
});

describe("writeFileAtomically", () => {
    it("replaces a file and leaves no temporary file", async () => {
        const target = path.join(dir, "dashql-workbook.json");
        await writeFileAtomically(target, "old");
        await writeFileAtomically(target, "new");
        await writeFileAtomically(path.join(dir, "a.parquet"), new Uint8Array([1, 2, 3]));
        expect(await readFile(target, "utf8")).toBe("new");
        expect(await readFile(path.join(dir, "a.parquet"))).toEqual(Buffer.from([1, 2, 3]));
        expect((await readdir(dir)).sort()).toEqual(["a.parquet", "dashql-workbook.json"]);
    });

    it("leaves the old file when the write fails", async () => {
        const target = path.join(dir, "a.sql");
        await writeFileAtomically(target, "select 1");
        // A directory can't be replaced by a file
        await expect(writeFileAtomically(dir, "x")).rejects.toThrow();
        await expect(writeFileAtomically(path.join(dir, "missing", "b.sql"), "x")).rejects.toThrow();
        expect(await readFile(target, "utf8")).toBe("select 1");
        expect(await readdir(dir)).toEqual(["a.sql"]);
    });
});
