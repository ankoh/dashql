export interface BlobStream {
    id: number;
    url: string;
    position: number;
}

export interface DuckDBRuntime {
    bindings: any;
    duckdb_web_add_blob_handle(handle: any): void;
    duckdb_web_blob_stream_open(url: string): number;
    duckdb_web_fs_read(blobId: number, buf: number, bytes: number): number;
    duckdb_web_fs_write(blobId: number, buf: number, bytes: number): number;
    duckdb_web_fs_directory_exists(pathPtr: number, pathLen: number): boolean;
    duckdb_web_fs_directory_create(pathPtr: number, pathLen: number): void;
    duckdb_web_fs_directory_remove(pathPtr: number, pathLen: number): void;
    duckdb_web_fs_directory_list_files(pathPtr: number, pathLen: number): boolean;
    duckdb_web_fs_glob(pathPtr: number, pathLen: number): void;
    duckdb_web_fs_file_open(pathPtr: number, pathLen: number, flags: number): number;
    duckdb_web_fs_file_close(blobId: number): void;
    duckdb_web_fs_file_get_size(blobId: number): number;
    duckdb_web_fs_file_get_last_modified_time(blobId: number): number;
    duckdb_web_fs_file_move(fromPtr: number, fromLen: number, toPtr: number, toLen: number): void;
    duckdb_web_fs_file_set_pointer(blobId: number, location: number): void;
    duckdb_web_fs_file_exists(pathPtr: number, pathLen: number): boolean;
    duckdb_web_fs_file_remove(pathPtr: number, pathLen: number): void;
}

export const DefaultDuckDBRuntime: DuckDBRuntime = {
    bindings: null,
    duckdb_web_add_blob_handle: (handle: any): number => {
        throw Error('undefined');
    },
    duckdb_web_blob_stream_open: (url: string): number => {
        throw Error('undefined');
    },
    duckdb_web_fs_read: (blobId: number, buf: number, bytes: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_write: (blobId: number, buf: number, bytes: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_directory_exists: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_directory_create: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_directory_remove: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_directory_list_files: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_glob: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_file_open: (pathPtr: number, pathLen: number, flags: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_file_close: (blobId: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_file_get_size: (blobId: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_file_get_last_modified_time: (blobId: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_file_move: (fromPtr: number, fromLen: number, toPtr: number, toLen: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_file_set_pointer: (blobId: number, location: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_file_exists: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
    duckdb_web_fs_file_remove: (pathPtr: number, pathLen: number) => {
        throw Error('undefined');
    },
};
