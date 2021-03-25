export interface BlobStream {
    url: string | null;
    buffer: Uint8Array | null;
    position: number;
}

// As a global function because when passing the object to the webworker it turns into a POJO
export function copyBlobStreamTo(blobStream: BlobStream, dest: Uint8Array, pos: number, length: number): number {
    if (blobStream.position >= blobStream.buffer!.length) return 0;
    let size = Math.min(length, blobStream.buffer!.length - blobStream.position);
    dest.set(blobStream.buffer!.slice(blobStream.position, blobStream.position + size), pos);
    blobStream.position += size;
    return size;
}

export interface WebDBRuntime {
    bindings: any;
    dashql_add_blob_stream(blob_stream: BlobStream): number;
    dashql_blob_stream_underflow(blobId: number, buf: number, size: number): number;
    dashql_webdb_fs_read(blobId: number, buf: number, bytes: number): number;
    dashql_webdb_fs_write(blobId: number, buf: number, bytes: number): number;
    dashql_webdb_fs_directory_exists(pathPtr: number, pathLen: number): boolean;
    dashql_webdb_fs_directory_create(pathPtr: number, pathLen: number): void;
    dashql_webdb_fs_directory_remove(pathPtr: number, pathLen: number): void;
    dashql_webdb_fs_directory_list_files(pathPtr: number, pathLen: number): boolean;
    dashql_webdb_fs_glob(pathPtr: number, pathLen: number): void;
    dashql_webdb_fs_file_open(pathPtr: number, pathLen: number, flags: number): number;
    dashql_webdb_fs_file_close(blobId: number): void;
    dashql_webdb_fs_file_get_size(blobId: number): number;
    dashql_webdb_fs_file_get_last_modified_time(blobId: number): number;
    dashql_webdb_fs_file_move(fromPtr: number, fromLen: number, toPtr: number, toLen: number): void;
    dashql_webdb_fs_file_set_pointer(blobId: number, location: number): void;
    dashql_webdb_fs_file_exists(pathPtr: number, pathLen: number): boolean;
    dashql_webdb_fs_file_remove(pathPtr: number, pathLen: number): void;
}

export var DefaultWebDBRuntime: WebDBRuntime = {
    bindings: null,
    dashql_add_blob_stream: (blob_stream: BlobStream): number => {
        throw Error('undefined');
    },
    dashql_blob_stream_underflow: (blobId: number, buf: number, size: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_read: (blobId: number, buf: number, bytes: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_write: (blobId: number, buf: number, bytes: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_directory_exists: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_directory_create: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_directory_remove: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_directory_list_files: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_glob: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_open: (pathPtr: number, pathLen: number, flags: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_close: (blobId: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_get_size: (blobId: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_get_last_modified_time: (blobId: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_move: (fromPtr: number, fromLen: number, toPtr: number, toLen: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_set_pointer: (blobId: number, location: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_exists: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_remove: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
};
