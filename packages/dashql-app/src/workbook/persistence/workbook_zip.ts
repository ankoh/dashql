// The core of zip.js on the main thread: its inline worker is a `blob:` script that the pages don't allow
// (docs/design/app_csp.md), and its wasm codec isn't needed, the browser deflates and inflates with CompressionStream.
import {
    BlobReader,
    BlobWriter,
    configure,
    TextReader,
    TextWriter,
    Uint8ArrayReader,
    Uint8ArrayWriter,
    ZipReader,
    ZipWriter,
    type Entry,
    type FileEntry,
} from '@zip.js/zip.js/lib/zip-core-custom.js';

configure({ useWebWorkers: false });

export { BlobReader, BlobWriter, TextReader, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter };
export type { Entry, FileEntry };

/// Can the browser deflate and inflate the entries of an archive? zip.js uses CompressionStream with `deflate-raw`,
/// Safari has it since 16.4.
function supportsArchiveCompression(): boolean {
    try {
        new CompressionStream('deflate-raw' as CompressionFormat);
        new DecompressionStream('deflate-raw' as CompressionFormat);
        return true;
    } catch {
        return false;
    }
}

/// The error of an archive that failed, clearer if the browser can't compress at all
export function archiveError(error: unknown): unknown {
    return supportsArchiveCompression() ? error
        : new Error(`This browser cannot compress the files of a workbook, it needs CompressionStream with deflate-raw (e.g. Safari 16.4 or newer): ${error instanceof Error ? error.message : String(error)}`);
}

/// The compression method of an entry that is stored as it is
const STORED = 0;
/// The signature and the fixed size of a local file header
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_LENGTH = 30;

/// The bytes of an entry as a slice of the archive, if the entry is stored without compression. The slice of a file
/// stays on disk until it is read, a large entry is never copied into memory. Null for a compressed or encrypted entry.
export async function storedEntryBlob(archive: Blob, entry: FileEntry): Promise<Blob | null> {
    if (entry.compressionMethod !== STORED || entry.encrypted) return null;
    // The central directory has the offset of the local header, the data follows its name and extra field
    const header = new DataView(await archive.slice(entry.offset, entry.offset + LOCAL_HEADER_LENGTH).arrayBuffer());
    if (header.byteLength < LOCAL_HEADER_LENGTH || header.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) {
        throw new Error(`Invalid ZIP: no local header for ${entry.filename}`);
    }
    const start = entry.offset + LOCAL_HEADER_LENGTH + header.getUint16(26, true) + header.getUint16(28, true);
    const end = start + entry.compressedSize;
    if (end > archive.size) throw new Error(`Invalid ZIP: ${entry.filename} ends after the archive`);
    return archive.slice(start, end);
}
