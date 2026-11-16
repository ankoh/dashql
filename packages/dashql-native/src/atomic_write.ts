import {randomBytes} from "node:crypto";
import {rename, rm, writeFile} from "node:fs/promises";
import path from "node:path";

/// Write a file atomically: a temporary file next to it, renamed over it. A reader sees the old file or the new one,
/// never a part, and a failed write leaves the old file as it was. The temporary file starts with a dot and ends with
/// `.tmp`, the listings of scripts and attachments never take it for one of theirs.
export async function writeFileAtomically(target: string, data: string | Uint8Array): Promise<void> {
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
    try {
        await writeFile(temporary, data);
        await rename(temporary, target);
    } catch (error) {
        await rm(temporary, {force: true});
        throw error;
    }
}
