// The messages between the converter and its workers (worker.ts). A module of its own, so that the converter doesn't
// import the worker and its types of the worker scope.
import type { CsvPartJob, CsvPartOutcome } from './part.js';

/// What the converter sends: the compiled module, the job and the folder of the parts
export interface CsvWorkerRequest {
    module: WebAssembly.Module;
    job: CsvPartJob;
    directory: FileSystemDirectoryHandle;
    /// The name of the Parquet file in the folder
    name: string;
}

/// What the worker sends back
export type CsvWorkerMessage =
    | { kind: 'progress'; bytesRead: number }
    | { kind: 'done'; outcome: CsvPartOutcome }
    | { kind: 'error'; message: string };
