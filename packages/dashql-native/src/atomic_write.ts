import {randomBytes} from "node:crypto";
import {open, rename, rm} from "node:fs/promises";
import path from "node:path";

/// The stamp of a file: its size and modification time
export interface FileStamp {
    size: number;
    mtimeMs: number;
}

/// Write a file atomically and durably: a temporary file next to it, synced to the disk and renamed over it. A reader
/// sees the old file or the new one, never a part, and a failed write leaves the old file as it was. The temporary file
/// starts with a dot and ends with `.tmp`, the listings of scripts and attachments never take it for one of theirs.
/// Returns the stamp of the temporary file, which the file keeps when it is renamed: a stamp taken after the rename
/// could be the one of a write of another program in between.
export async function writeFileAtomically(target: string, data: string | Uint8Array): Promise<FileStamp> {
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
    try {
        const file = await open(temporary, "w");
        let stamp: FileStamp;
        try {
            await file.writeFile(data);
            await file.sync();
            const stats = await file.stat();
            stamp = {size: stats.size, mtimeMs: stats.mtimeMs};
        } finally {
            await file.close();
        }
        await rename(temporary, target);
        return stamp;
    } catch (error) {
        await rm(temporary, {force: true});
        throw error;
    }
}
