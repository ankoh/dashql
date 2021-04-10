// Copyright (c) 2020 The DashQL Authors

import { DuckDBRuntime, FileFlags } from './runtime_base';
import globToRegexp from 'glob-to-regexp';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const pageSize = 1024 * 1024;
const maxPages = 32;

interface WebBlobHandle {
    url: string;
}

interface WriteWebBlobHandle extends WebBlobHandle {
    parts: Uint8Array[];
    size: number;
}

interface ReadWebBlobHandle extends WebBlobHandle {
    blob: Blob;
    page_queue: number[];
    pages: Map<number, Uint8Array>;
}

export interface BlobStream {
    id: number;
    handle: WebBlobHandle;
    position: number;
}

export var BrowserDuckDBRuntime: DuckDBRuntime & {
    readHandleMap: Map<string, ReadWebBlobHandle>;
    writeHandleMap: Map<string, WriteWebBlobHandle>;
    streamMap: Map<number, BlobStream>;
    streamCounter: number;
} = {
    readHandleMap: new Map<string, ReadWebBlobHandle>(),
    writeHandleMap: new Map<string, WriteWebBlobHandle>(),
    streamMap: new Map<number, BlobStream>(),
    streamCounter: 1,
    bindings: null,

    duckdb_web_add_blob_handle: function (handle: any): void {
        if (BrowserDuckDBRuntime.readHandleMap.has(handle.url)) {
            // Somewhat silently fail adding duplicate blob handle
            // Not overwriting entry since blobstreams refer to their handle
            console.info('URL already registered: ' + handle.url);
        } else {
            BrowserDuckDBRuntime.readHandleMap.set(handle.url, {
                url: handle.url,
                blob: handle.blob,
                page_queue: [],
                pages: new Map<number, Uint8Array>(),
            });
        }
    },
    duckdb_web_fs_read: function (blobId: number, buf: number, bytes: number) {
        const reader = new FileReaderSync();
        const loader = (handle: ReadWebBlobHandle, page: number): Uint8Array => {
            if (!handle.pages.has(page)) {
                while (handle.page_queue.length > maxPages) {
                    handle.pages.delete(handle.page_queue.shift()!);
                }

                handle.page_queue.push(page);
                const blob = handle.blob.slice(page * pageSize, (page + 1) * pageSize);
                handle.pages.set(page, new Uint8Array(reader.readAsArrayBuffer(blob)));
            }

            if (handle.page_queue[handle.page_queue.length - 1] != page) {
                // Move page to back of queue due to recent access
                handle.page_queue.push(handle.page_queue.splice(handle.page_queue.indexOf(page), 1)[0]);
            }

            return handle.pages.get(page)!;
        };

        let stream = BrowserDuckDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;

        let heap: Uint8Array = BrowserDuckDBRuntime.bindings!.instance!.HEAPU8;
        let read = 0;

        while (bytes > 0) {
            const pageId = Math.trunc(stream.position / pageSize);
            const page = loader(<ReadWebBlobHandle>stream.handle, pageId);

            const pageStart = stream.position - pageId * pageSize;
            const size = Math.min(bytes, page.length - pageStart);
            heap.set(page.subarray(pageStart, pageStart + size), buf);
            buf += size;
            stream.position += size;
            bytes -= size;
            read += size;
        }

        return read;

        //
        // ad-hoc creation of small blobs is slower than creating big chunks and managing those as pages
        //
        // const size = Math.min(bytes, handle.blob.size - stream.position);
        // const blob = handle.blob.slice(stream.position, stream.position + size);
        // heap.set(new Uint8Array(reader.readAsArrayBuffer(blob)), buf);
        // stream.position += size;
        // return size;
    },
    duckdb_web_fs_write: function (blobId: number, buf: number, bytes: number) {
        let stream = BrowserDuckDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;
        let heap: Uint8Array = BrowserDuckDBRuntime.bindings!.instance!.HEAPU8;
        let handle = <WriteWebBlobHandle>stream.handle;
        if (stream.position == handle.size) {
            const part = new Uint8Array(heap.buffer.slice(buf, buf + bytes));
            handle.parts.push(part);
            handle.size += part.length;
            stream.position += part.length;
            return part.length;
        } else {
            throw Error('Random write not supported');
        }
    },
    duckdb_web_fs_directory_exists: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
    duckdb_web_fs_directory_create: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
    duckdb_web_fs_directory_remove: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
    duckdb_web_fs_directory_list_files: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
    duckdb_web_fs_glob: function (pathPtr: number, pathLen: number) {
        let instance = BrowserDuckDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        let re = globToRegexp(path);
        for (let url of BrowserDuckDBRuntime.readHandleMap.keys()) {
            if (re.test(url)) {
                const data = encoder.encode(url);
                const ptr = instance.stackAlloc(data.length);
                instance.HEAPU8.set(data, ptr);
                BrowserDuckDBRuntime.bindings!.instance!.ccall(
                    'duckdb_web_fs_glob_callback',
                    null,
                    ['number', 'number'],
                    [ptr, data.length],
                );
            }
        }
    },
    duckdb_web_fs_file_open: function (pathPtr: number, pathLen: number, flags: number) {
        let instance = BrowserDuckDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));

        if ((flags & FileFlags.FILE_FLAGS_READ) == FileFlags.FILE_FLAGS_READ) {
            const handle = BrowserDuckDBRuntime.readHandleMap.get(path);
            if (!handle) throw Error('File not found or cannot be opened: ' + path);

            const id = BrowserDuckDBRuntime.streamCounter;
            BrowserDuckDBRuntime.streamMap.set(id, {
                id: id,
                handle: handle,
                position: 0,
            });
            BrowserDuckDBRuntime.streamCounter++;
            return id;
        } else if ((flags & FileFlags.FILE_FLAGS_WRITE) == FileFlags.FILE_FLAGS_WRITE) {
            let handle = BrowserDuckDBRuntime.writeHandleMap.get(path);
            if (handle) throw Error('File is already opened: ' + path);

            handle = {
                url: path,
                parts: [],
                size: 0,
            };

            BrowserDuckDBRuntime.writeHandleMap.set(path, handle);

            const id = BrowserDuckDBRuntime.streamCounter;
            BrowserDuckDBRuntime.streamMap.set(id, {
                id: id,
                handle: handle,
                position: 0,
            });
            BrowserDuckDBRuntime.streamCounter++;
            return id;
        } else {
            throw Error('Unsupported file flags: ' + flags);
        }
    },
    duckdb_web_fs_file_close: function (blobId: number) {
        BrowserDuckDBRuntime.streamMap.delete(blobId);
    },
    duckdb_web_fs_file_get_size: function (blobId: number) {
        let stream = BrowserDuckDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;
        return (<ReadWebBlobHandle>BrowserDuckDBRuntime.readHandleMap.get(stream.handle.url)!).blob.size;
    },
    duckdb_web_fs_file_get_last_modified_time: function (blobId: number) {
        // TODO: Keep fetch response header to answer BrowserDuckDBRuntime
        return 0;
    },
    duckdb_web_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        throw Error('undefined');
    },
    duckdb_web_fs_file_set_pointer: function (blobId: number, location: number) {
        let stream = BrowserDuckDBRuntime.streamMap.get(blobId);
        if (stream) stream.position = location;
    },
    duckdb_web_fs_file_exists: function (pathPtr: number, pathLen: number) {
        let instance = BrowserDuckDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return BrowserDuckDBRuntime.readHandleMap.has(path);
    },
    duckdb_web_fs_file_remove: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
};
