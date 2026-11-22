// The conversion of a CSV file to Parquet with temporary workers: one per range of the file, each writes a Parquet file
// of its own, see docs/design/csv_sniffer.md. The module plans the ranges, checks the guesses of the quote states and
// writes the query over the parts; this starts the workers and moves the files.
import * as glue from '../wasm/csv_sniffer.js';

import { convertPart, MemoryPartSink, type CsvPartJob, type CsvPartOutcome, type CsvPartTask } from './part.js';
import type { CsvWorkerMessage, CsvWorkerRequest } from './worker_protocol.js';

/// A sample of a file that a conversion starts from, see `CsvSniffer.sample`
export interface CsvConversionSource {
    readonly file: Blob;
    /// The names of the columns
    readonly names: string[];
    /// The plan of the conversion as JSON
    plan(): string;
    /// The ranges of the file for up to `maxParts` workers, of at least `minPartBytes` each
    planParts(maxParts: number, minPartBytes?: number): CsvPartTask[];
}

/// A finished part: a Parquet file of a range of the CSV file
export interface CsvPartFile {
    index: number;
    file: Blob;
    rows: number;
    /// The types of its columns in SQL, the parts may differ
    types: string[];
    /// The conversions of the part with wider types
    reruns: number;
}

/// Runs the conversion of a part and returns its Parquet file
export type CsvPartRunner = (
    job: CsvPartJob,
    onProgress: (bytesRead: number) => void,
    signal?: AbortSignal,
) => Promise<{ outcome: CsvPartOutcome; file: Blob }>;

/// Run the parts in the thread of the caller, one after another, into memory. For tests and hosts without workers.
export const inThreadRunner: CsvPartRunner = async (job, onProgress, signal) => {
    const sink = new MemoryPartSink();
    const outcome = await convertPart(job, sink, onProgress, signal);
    return { outcome, file: sink.blob() };
};

/// The name of the Parquet file of a part
function partName(index: number): string {
    return `part-${String(index).padStart(4, '0')}.parquet`;
}

/// Run every part in a temporary worker of its own that writes its Parquet file into a folder of the origin private
/// file system. The worker instantiates the compiled module and goes when its part is done.
export function workerRunner(module: WebAssembly.Module, directory: FileSystemDirectoryHandle): CsvPartRunner {
    return (job, onProgress, signal) => new Promise((resolve, reject) => {
        const name = partName(job.task.index);
        const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: `csv ${name}` });
        const finish = () => {
            worker.terminate();
            signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            finish();
            reject(signal?.reason ?? new DOMException('The conversion was aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort);
        worker.onmessage = (event: MessageEvent<CsvWorkerMessage>) => {
            const message = event.data;
            if (message.kind === 'progress') {
                onProgress(message.bytesRead);
            } else if (message.kind === 'error') {
                finish();
                reject(new Error(message.message));
            } else {
                finish();
                directory.getFileHandle(name).then(handle => handle.getFile()).then(
                    file => resolve({ outcome: message.outcome, file }),
                    reject,
                );
            }
        };
        worker.onerror = event => {
            finish();
            reject(new Error(event.message || `the worker of ${name} failed`));
        };
        worker.postMessage({ module, job, directory, name } satisfies CsvWorkerRequest);
    });
}

/// A folder of its own in the origin private file system for the parts of a conversion
export async function createPartDirectory(): Promise<{ directory: FileSystemDirectoryHandle; remove: () => Promise<void> }> {
    const root = await navigator.storage.getDirectory();
    const parts = await root.getDirectoryHandle('csv-parts', { create: true });
    const id = crypto.randomUUID();
    const directory = await parts.getDirectoryHandle(id, { create: true });
    return { directory, remove: () => parts.removeEntry(id, { recursive: true }) };
}

/// The options of a conversion
export interface CsvConvertOptions {
    /// The workers at most, one per part. By default the cores of the machine, at most 8.
    maxWorkers?: number;
    /// Runs the parts, by default `workerRunner` into a folder of `createPartDirectory`
    runner?: CsvPartRunner;
    /// Called with the parts before they start, one per worker
    onPlan?: (tasks: CsvPartTask[]) => void;
    /// Called with the bytes of the file that the parts read
    onProgress?: (bytesRead: number, bytesTotal: number) => void;
    signal?: AbortSignal;
    /// The bytes of a chunk, for tests
    chunkBytes?: number;
    /// The bytes of a part at least, 16 MiB by default; for tests
    minPartBytes?: number;
}

/// A CSV file converted to Parquet files, one per part
export class CsvConversion {
    constructor(
        readonly names: string[],
        readonly parts: CsvPartFile[],
        /// The milliseconds of the conversion
        readonly milliseconds: number,
        /// The parts that started in quoted text and were converted again
        readonly quoteReruns: number,
        /// Removes the files of the parts
        readonly remove: () => Promise<void>,
    ) { }

    /// The rows of the table
    get rows(): number {
        return this.parts.reduce((rows, part) => rows + part.rows, 0);
    }

    /// The query that reads the parts as one table, with the paths of their files in Hyper in the order of the parts
    unionQuery(paths: string[]): string {
        if (paths.length !== this.parts.length) throw new Error(`${this.parts.length} parts, but ${paths.length} paths`);
        return glue.unionQuery(this.names, this.parts.map((part, i) => ({ path: paths[i], types: part.types })));
    }
}

/// The cores to use: all but one, at most 8
function defaultWorkers(): number {
    const cores = typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency ?? 1;
    return Math.max(1, Math.min(8, cores - 1));
}

/// Convert a CSV file to Parquet files, one per range of the file. The module of the glue is instantiated (by the
/// sniffer of the source).
export async function convertCsv(source: CsvConversionSource, module: WebAssembly.Module, options: CsvConvertOptions = {}): Promise<CsvConversion> {
    const started = performance.now();
    let remove = async () => { };
    let runner = options.runner;
    if (runner == null) {
        const parts = await createPartDirectory();
        remove = parts.remove;
        runner = workerRunner(module, parts.directory);
    }
    try {
        const plan = source.plan();
        const tasks = source.planParts(options.maxWorkers ?? defaultWorkers(), options.minPartBytes);
        options.onPlan?.(tasks);
        const progress = tasks.map(() => 0);
        const run = (task: CsvPartTask) => runner({ plan, task, file: source.file, chunkBytes: options.chunkBytes }, bytesRead => {
            const end = task.end ?? source.file.size;
            progress[task.index] = Math.min(bytesRead, end - task.start);
            options.onProgress?.(progress.reduce((sum, bytes) => sum + bytes, 0), source.file.size);
        }, options.signal);

        // Every part guesses that its range doesn't start in quoted text, the quotes of the parts before it tell
        const results = await Promise.all(tasks.map(run));
        const states = glue.quoteStates(Float64Array.from(results, ({ outcome }) => outcome.result.quotes));
        const wrong = tasks.filter((task, i) => Boolean(states[i]) !== task.inQuotes);
        await Promise.all(wrong.map(async task => {
            results[task.index] = await run({ ...task, inQuotes: !task.inQuotes });
        }));

        const parts: CsvPartFile[] = results.map(({ outcome, file }, index) => ({
            index,
            file,
            rows: outcome.result.rows,
            types: outcome.result.types,
            reruns: outcome.reruns,
        }));
        return new CsvConversion(source.names, parts, performance.now() - started, wrong.length, remove);
    } catch (e) {
        await remove();
        throw e;
    }
}
