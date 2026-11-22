// @akohn/csv-sniffer: finds the schema of a CSV file by a sample and converts the file to Parquet with temporary
// workers, see docs/design/csv_sniffer.md. The module decides everything about the file, this wrapper reads its chunks
// and hands them over.
import * as glue from '../wasm/csv_sniffer.js';

import type { CsvColumnView, CsvFormatView, CsvSchemaView } from '../wasm/csv_sniffer.js';
import { convertCsv, type CsvConversion, type CsvConversionSource, type CsvConvertOptions } from './converter.js';
import type { CsvPartTask } from './part.js';

export {
    CsvConversion,
    convertCsv,
    createPartDirectory,
    inThreadRunner,
    workerRunner,
    type CsvConvertOptions,
    type CsvPartFile,
    type CsvPartRunner,
} from './converter.js';
export type { CsvPartJob, CsvPartOutcome, CsvPartResult, CsvPartTask } from './part.js';

/// The format of a CSV file: the encoding, the dialect, where the data starts
export type CsvFormat = CsvFormatView;
/// The schema of a scanned CSV file: the columns with their types, the rows, a preview and the problems for Hyper
export type CsvSchema = CsvSchemaView;
/// A column of the schema of a CSV file
export type CsvColumn = CsvColumnView;

/// The URL of the Wasm next to the glue, for a host that loads it itself
export const csvSnifferWasmUrl: URL = glue.wasmUrl;

/// The first bytes of a file that the sniffer finds the format in
const SNIFF_BYTES = 1024 * 1024;
/// The bytes of a chunk that the scanner reads at once
const CHUNK_BYTES = 4 * 1024 * 1024;
/// The rows of the preview
const PREVIEW_ROWS = 50;

/// Load the Wasm next to its glue
async function loadDefaultWasm(): Promise<Uint8Array<ArrayBuffer>> {
    const url = glue.wasmUrl;
    if (url.protocol === 'file:') {
        // Node: fetch does not support file URLs. The specifier is not static to keep bundlers away.
        const fs = 'node:fs/promises';
        const { readFile } = await import(/* @vite-ignore */ fs);
        return new Uint8Array(await readFile(url));
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch the CSV sniffer: ${response.status} ${response.statusText}`);
    return new Uint8Array(await response.arrayBuffer());
}

/// The options of the module
export interface CsvSnifferOptions {
    /// The Wasm binary
    wasmBinary?: Uint8Array<ArrayBuffer> | ArrayBuffer;
    /// A precompiled Wasm module, takes precedence over the binary
    module?: WebAssembly.Module;
}

/// The options of a scan
export interface CsvScanOptions {
    /// Called after every chunk with the bytes of the file that were read
    onProgress?: (bytesRead: number, bytesTotal: number) => void;
    /// Stops the scan between two chunks
    signal?: AbortSignal;
    /// The bytes of a chunk, for tests
    chunkBytes?: number;
}

/// A scanned CSV file
export class CsvScan {
    /// The file
    readonly file: Blob;
    readonly format: CsvFormat;
    readonly schema: CsvSchema;
    /// The bytes that Hyper reads: the data of the file in UTF-8, without the preamble and the blank lines at the end
    readonly data: Blob;
    private scanner: glue.CsvFileScanner | null;

    constructor(file: Blob, format: CsvFormat, schema: CsvSchema, data: Blob, scanner: glue.CsvFileScanner) {
        this.file = file;
        this.format = format;
        this.schema = schema;
        this.data = data;
        this.scanner = scanner;
    }

    /// The query that reads the data with Hyper, at a path where Hyper finds `data`
    selectQuery(path: string): string {
        if (this.scanner == null) throw new Error('the scan is released');
        return this.scanner.selectQuery(path);
    }

    /// Release the scan in the module
    release(): void {
        this.scanner?.free();
        this.scanner = null;
    }
}

/// A sample of a CSV file: its format from its first bytes, and the schema of its first bytes and of windows across
/// the file. The conversion starts from it.
export class CsvSample implements CsvConversionSource {
    readonly file: Blob;
    readonly format: CsvFormat;
    readonly schema: CsvSchema;
    private scanner: glue.CsvFileScanner | null;

    constructor(file: Blob, format: CsvFormat, schema: CsvSchema, scanner: glue.CsvFileScanner) {
        this.file = file;
        this.format = format;
        this.schema = schema;
        this.scanner = scanner;
    }

    private get live(): glue.CsvFileScanner {
        if (this.scanner == null) throw new Error('the sample is released');
        return this.scanner;
    }

    /// The names of the columns
    get names(): string[] {
        return this.schema.columns.map(column => column.name);
    }

    /// The plan of the conversion as JSON: the format of the file and the columns
    plan(): string {
        return this.live.partPlan();
    }

    /// The ranges of the file for up to `maxParts` workers, of at least `minPartBytes` each (16 MiB by default)
    planParts(maxParts: number, minPartBytes?: number): CsvPartTask[] {
        return this.live.planParts(this.file.size, maxParts, minPartBytes);
    }

    /// Release the sample in the module
    release(): void {
        this.scanner?.free();
        this.scanner = null;
    }
}

let instantiated: Promise<WebAssembly.Module> | null = null;

/// The CSV sniffer. A wasm-bindgen module is instantiated once per JS module, the sniffers share it. The compiled
/// module goes to the workers of a conversion.
export class CsvSniffer {
    /// The compiled module
    readonly module: WebAssembly.Module;

    private constructor(module: WebAssembly.Module) {
        this.module = module;
        glue.installPanicHook();
    }

    /// Create a sniffer, the module is compiled and instantiated by the first one
    public static async create(options?: CsvSnifferOptions): Promise<CsvSniffer> {
        instantiated ??= (async () => {
            const module = options?.module ?? await WebAssembly.compile(options?.wasmBinary ?? await loadDefaultWasm());
            await glue.default({ module_or_path: module });
            return module;
        })();
        try {
            return new CsvSniffer(await instantiated);
        } catch (e) {
            instantiated = null;
            throw e;
        }
    }

    /// Sample a CSV file: its format and the schema of its first MiB and of windows across the file. Fast for files of
    /// any size; a value that the sample missed widens the types of its part in the conversion.
    public async sample(file: Blob, options: { signal?: AbortSignal } = {}): Promise<CsvSample> {
        const prefix = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
        options.signal?.throwIfAborted();
        const complete = file.size <= SNIFF_BYTES;
        const scanner = glue.CsvFileScanner.sniff(prefix, complete, PREVIEW_ROWS);
        try {
            const format = scanner.format();
            scanner.push(prefix);
            for (const window of scanner.sampleWindows(file.size, prefix.length)) {
                scanner.sampleWindow(new Uint8Array(await file.slice(window.start, window.end).arrayBuffer()));
                options.signal?.throwIfAborted();
            }
            scanner.finishSample(complete);
            return new CsvSample(file, format, scanner.schema(), scanner);
        } catch (e) {
            scanner.free();
            throw e;
        }
    }

    /// Convert a sampled file to Parquet files, one per range of the file, in temporary workers
    public convert(sample: CsvSample, options?: CsvConvertOptions): Promise<CsvConversion> {
        return convertCsv(sample, this.module, options);
    }

    /// Scan a CSV file: find its format in its first bytes, then read all of it in chunks. A file that is no UTF-8 is
    /// decoded, the data of the scan is the UTF-8 then.
    public async scan(file: Blob, options: CsvScanOptions = {}): Promise<CsvScan> {
        const throwIfAborted = () => options.signal?.throwIfAborted();
        const prefix = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
        throwIfAborted();
        const scanner = glue.CsvFileScanner.sniff(prefix, file.size <= SNIFF_BYTES, PREVIEW_ROWS);
        try {
            const format = scanner.format();
            const decoded: Uint8Array<ArrayBuffer>[] = [];
            // The glue copies the bytes out of the memory of the module into an ArrayBuffer of their own
            const keep = (bytes: Uint8Array | undefined) => {
                if (bytes != null && bytes.length > 0) decoded.push(bytes as Uint8Array<ArrayBuffer>);
            };
            const chunkBytes = options.chunkBytes ?? CHUNK_BYTES;
            for (let offset = 0; offset < file.size; offset += chunkBytes) {
                const chunk = new Uint8Array(await file.slice(offset, offset + chunkBytes).arrayBuffer());
                throwIfAborted();
                keep(scanner.push(chunk));
                options.onProgress?.(Math.min(offset + chunkBytes, file.size), file.size);
            }
            keep(scanner.finish());
            const schema = scanner.schema();
            const utf8 = format.transcoded ? new Blob(decoded) : file;
            const data = utf8.slice(format.dataOffset, schema.dataEnd);
            return new CsvScan(file, format, schema, data, scanner);
        } catch (e) {
            scanner.free();
            throw e;
        }
    }
}
