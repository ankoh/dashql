import { archiveError, BlobReader, BlobWriter, ZipReader, type FileEntry } from '@akohn/dashql/platform/workbook/workbook_zip';

// The entries of a `.dashql` file as the unpacker tool lists them. Only the ZIP container: the Parquet files are read
// by the embedded Hyper when a card opens, see use_parquet_computation.ts.

/// The compression method of an entry that is stored as it is
const STORED = 0;

/// A file of an archive
export interface ArchiveFile {
    /// The position of the entry in the archive
    index: number;
    fileName: string;
    /// The bytes of the entry in the archive
    compressedSize: number;
    /// The bytes of the file
    uncompressedSize: number;
    /// Is the file stored without compression?
    stored: boolean;
    /// Read the file into memory, checked against the CRC-32 of its entry
    read(): Promise<Blob>;
}

/// An opened archive, its files in the order of the archive
export interface UnpackedArchive {
    /// The name of the file that was dropped
    name: string;
    /// The bytes of the archive
    size: number;
    files: ArchiveFile[];
    /// Close the reader of the archive
    close(): Promise<void>;
}

/// Is a file of the archive a Parquet file?
export const isParquetFile = (file: ArchiveFile): boolean => file.fileName.endsWith('.parquet');

/// Read the central directory of an archive
export async function openArchive(file: File): Promise<UnpackedArchive> {
    const zip = new ZipReader(new BlobReader(file), { filenameValidation: 'tolerant' });
    try {
        const entries = await zip.getEntries();
        const files = entries.flatMap((entry, index): ArchiveFile[] => {
            if (entry.directory) return [];
            const fileEntry = entry as FileEntry;
            return [{
                index,
                fileName: fileEntry.filename,
                compressedSize: fileEntry.compressedSize,
                uncompressedSize: fileEntry.uncompressedSize,
                stored: fileEntry.compressionMethod === STORED,
                read: async () => {
                    try {
                        return await fileEntry.getData(new BlobWriter(), { checkCrc32: true });
                    } catch (error) {
                        throw archiveError(error);
                    }
                },
            }];
        });
        return { name: file.name, size: file.size, files, close: async () => { await zip.close().catch(() => { }); } };
    } catch (error) {
        await zip.close().catch(() => { });
        throw archiveError(error);
    }
}
