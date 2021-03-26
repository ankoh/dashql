export class BlobStream {
    id: number;
    handle: BlobHandle;
    position: number;

    public constructor(id: number, handle: BlobHandle) {
        this.id = id;
        this.handle = handle;
        this.position = 0;
    }

    public copyTo(dest: Uint8Array, pos: number, length: number): number {
        if (this.position >= this.handle.buffer!.length) return 0;
        let size = Math.min(length, this.handle.buffer!.length - this.position);
        dest.set(this.handle.buffer!.slice(this.position, this.position + size), pos);
        this.position += size;
        return size;
    }
}

export abstract class BlobHandle {
    url: string;
    buffer: Uint8Array | null;

    public constructor(url: string) {
        this.url = url;
        this.buffer = null;
    }

    public abstract open(): void;
}

export interface WebDBRuntime {
    bindings: any;
    dashql_add_blob_handle(blob_handle: BlobHandle): void;
    dashql_blob_stream_open(url: string): number;
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

export const DefaultWebDBRuntime: WebDBRuntime = {
    bindings: null,
    dashql_add_blob_handle: (blob_handle: BlobHandle): number => {
        throw Error('undefined');
    },
    dashql_blob_stream_open: (url: string): number => {
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
