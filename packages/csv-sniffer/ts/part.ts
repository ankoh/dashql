// The conversion of one part of a CSV file, in a worker or in the thread of the caller. The module decides the
// records, the types and the bytes of the Parquet file; this reads the chunks of the range and moves the bytes.
import * as glue from '../wasm/csv_sniffer.js';

import type { CsvPartResultView, CsvPartTaskView } from '../wasm/csv_sniffer.js';

/// A part of a file to convert
export type CsvPartTask = CsvPartTaskView;
/// What a part counted
export type CsvPartResult = CsvPartResultView;

/// The bytes of a chunk that a part reads at once
const CHUNK_BYTES = 4 * 1024 * 1024;
/// The conversions of a part with wider types: each widens at least one column, the types have few steps
const MAX_RERUNS = 8;

/// What a worker gets to convert a part
export interface CsvPartJob {
    /// The plan of the conversion as JSON: the format of the file and the columns
    plan: string;
    task: CsvPartTask;
    file: Blob;
    /// The bytes of a chunk, for tests
    chunkBytes?: number;
}

/// The finished part: what it counted and the plan it was converted with
export interface CsvPartOutcome {
    result: CsvPartResult;
    /// The plan with the columns the part ended with
    plan: string;
    /// The conversions with wider types
    reruns: number;
}

/// Where a part writes its Parquet file
export interface CsvPartSink {
    /// Drop what was written, the part is converted again
    reset(): void;
    write(bytes: Uint8Array): void;
}

/// Convert a part into a sink, again with wider types until every value fits. The module of the glue is instantiated.
export async function convertPart(
    job: CsvPartJob,
    sink: CsvPartSink,
    onProgress?: (bytesRead: number) => void,
    signal?: AbortSignal,
): Promise<CsvPartOutcome> {
    const chunkBytes = job.chunkBytes ?? CHUNK_BYTES;
    let plan = job.plan;
    for (let reruns = 0; ; ++reruns) {
        sink.reset();
        const converter = new glue.CsvPartConverter(plan, job.task);
        try {
            const start = converter.inputStart();
            let offset = start;
            while (offset < job.file.size && !converter.done()) {
                const chunk = new Uint8Array(await job.file.slice(offset, offset + chunkBytes).arrayBuffer());
                signal?.throwIfAborted();
                sink.write(converter.push(chunk));
                offset += chunk.length;
                onProgress?.(offset - start);
            }
            sink.write(converter.finish());
            const result = converter.result();
            if (result.widenedPlan == null) return { result, plan, reruns };
            if (reruns === MAX_RERUNS) throw new Error(`part ${job.task.index} still widens its columns after ${MAX_RERUNS} conversions`);
            plan = result.widenedPlan;
        } finally {
            converter.free();
        }
    }
}

/// A sink in memory, for a conversion in the thread of the caller
export class MemoryPartSink implements CsvPartSink {
    private chunks: Uint8Array<ArrayBuffer>[] = [];

    reset(): void {
        this.chunks = [];
    }

    write(bytes: Uint8Array): void {
        // The glue copies the bytes out of the memory of the module into an ArrayBuffer of their own
        if (bytes.length > 0) this.chunks.push(bytes as Uint8Array<ArrayBuffer>);
    }

    /// The Parquet file
    blob(): Blob {
        return new Blob(this.chunks, { type: 'application/vnd.apache.parquet' });
    }
}
