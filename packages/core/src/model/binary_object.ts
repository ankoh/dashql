// Copyright (c) 2020 The DashQL Authors

import * as proto from '@dashql/proto';
import { PlanObject } from './plan_object';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';

/// A blob path
export interface BinaryObject extends PlanObject {
    /// The data size
    dataSize: number;
    /// The array buffer (if any)
    dataBuffer: ArrayBuffer | null;
    /// The blob (if any)
    dataBlob: Blob | null;
    /// The data url (if any)
    dataURL: string | null;
    /// The archive mode (if any)
    archiveMode: proto.analyzer.ArchiveMode;
}

export async function persistBinaryObject(buffer: BinaryObject): Promise<BinaryObject> {
    // Is there an array buffer?
    if (buffer.dataBuffer) {
        // Browser?
        if (process.env.ENV_BROWSER !== undefined) {
            buffer.dataBlob = new Blob([buffer.dataBuffer]);
            buffer.dataBuffer = null;
        }

        // Node.js write to disk
        else {
            const tmp = await import('tmp');
            const fs = await import('fs');
            const tmpName: string = await new Promise((resolve, reject) => {
                tmp.file((err, name, _fd, _removeCallback) => {
                    if (err) reject(err);
                    resolve(name);
                });
            });
            if (fs.existsSync(tmpName)) {
                fs.truncateSync(tmpName);
            }
            fs.writeFileSync(tmpName, new Uint8Array(buffer.dataBuffer), {
                encoding: 'binary',
            });
            buffer.dataBuffer = null;
            buffer.dataURL = tmpName;
        }
    }
    return buffer;
}

export async function readBinaryObjectAsBuffer(buffer: BinaryObject): Promise<ArrayBuffer> {
    if (buffer.dataBuffer != null) return buffer.dataBuffer;
    if (process.env.ENV_BROWSER !== undefined) {
        console.assert(buffer.dataBlob != null);
        return await buffer.dataBlob.arrayBuffer();
    } else {
        const fs = await import('fs');
        console.assert(buffer.dataURL != null);
        return (await fs.promises.readFile(buffer.dataURL, null)).buffer;
    }
}

export async function registerBinaryObject(name: string, buffer: BinaryObject, db: duckdb.AsyncDuckDB): Promise<void> {
    if (buffer.dataBlob) {
        await db.registerFileHandle(name, buffer.dataBlob);
    } else if (buffer.dataURL) {
        await db.registerFileURL(name, buffer.dataURL);
    } else if (buffer.dataBuffer) {
        await db.registerFileBuffer(name, new Uint8Array(buffer.dataBuffer));
    } else {
        await db.registerEmptyFileBuffer(name);
    }
}
