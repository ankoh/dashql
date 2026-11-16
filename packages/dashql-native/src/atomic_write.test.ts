import {mkdtemp, readdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {writeFileAtomically} from "./atomic_write.js";

/// Runs right after the next rename of a file, e.g. a write of another program
const afterRename: {next: (() => Promise<void>) | null} = vi.hoisted(() => ({next: null}));
vi.mock("node:fs/promises", async importOriginal => {
    const original = await importOriginal<typeof import("node:fs/promises")>();
    return {
        ...original,
        rename: async (from: string, to: string) => {
            await original.rename(from, to);
            const next = afterRename.next;
            afterRename.next = null;
            await next?.();
        },
    };
});

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

    it("returns the stamp of its own write, not of a write of another program right after it", async () => {
        const target = path.join(dir, "a.sql");
        const own = await writeFileAtomically(target, "select 1");
        const stats = await stat(target);
        expect(own).toEqual({size: stats.size, mtimeMs: stats.mtimeMs});
        afterRename.next = () => writeFile(target, "select 2 from another program");
        const stamp = await writeFileAtomically(target, "select 3");
        expect(stamp.size).toBe(8);
        expect((await stat(target)).size).not.toBe(8);
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
