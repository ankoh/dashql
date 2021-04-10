export interface DuckDBRuntime {
    bindings: any;
    duckdb_web_add_handle(url: string, handle: any): void;
    duckdb_web_get_absolute_url(url: string): string | null;
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

export enum FileFlags {
    // Open file with read access
    FILE_FLAGS_READ = 1 << 0,
    // Open file with read/write access
    FILE_FLAGS_WRITE = 1 << 1,
    // Use direct IO when reading/writing to the file
    FILE_FLAGS_DIRECT_IO = 1 << 2,
    // Create file if not exists, can only be used together with WRITE
    FILE_FLAGS_FILE_CREATE = 1 << 3,
    // Always create a new file. If a file exists, the file is truncated. Cannot be used together with CREATE.
    FILE_FLAGS_FILE_CREATE_NEW = 1 << 4,
    // Open file in append mode
    FILE_FLAGS_APPEND = 1 << 5,
}

export const DefaultDuckDBRuntime: DuckDBRuntime = {
    bindings: null,
    duckdb_web_add_handle: (url: string, handle: any): number => {
        throw Error('undefined');
    },
    duckdb_web_get_absolute_url: (url: string): string | null => {
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
