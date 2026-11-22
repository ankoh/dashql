// A temporary worker that converts one part of a CSV file into a Parquet file of the origin private file system. The
// converter (converter.ts) starts one per part and terminates it when the part is done.
import * as glue from '../wasm/csv_sniffer.js';

import { convertPart, type CsvPartSink } from './part.js';
import type { CsvWorkerMessage, CsvWorkerRequest } from './worker_protocol.js';

/// A sink into a file of the origin private file system, written with a synchronous access handle
class SyncFileSink implements CsvPartSink {
    private position = 0;

    constructor(private readonly handle: FileSystemSyncAccessHandle) { }

    reset(): void {
        this.handle.truncate(0);
        this.position = 0;
    }

    write(bytes: Uint8Array): void {
        if (bytes.length === 0) return;
        this.position += this.handle.write(bytes as Uint8Array<ArrayBuffer>, { at: this.position });
    }
}

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const post = (message: CsvWorkerMessage) => scope.postMessage(message);

scope.onmessage = async (event: MessageEvent<CsvWorkerRequest>) => {
    const { module, job, directory, name } = event.data;
    let handle: FileSystemSyncAccessHandle | null = null;
    try {
        glue.initSync({ module });
        const file = await directory.getFileHandle(name, { create: true });
        handle = await file.createSyncAccessHandle();
        const outcome = await convertPart(job, new SyncFileSink(handle), bytesRead => post({ kind: 'progress', bytesRead }));
        handle.flush();
        post({ kind: 'done', outcome });
    } catch (e) {
        post({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
        handle?.close();
    }
};
