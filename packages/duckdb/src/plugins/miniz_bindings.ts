// Copyright (c) 2020 The DashQL Authors

import { DuckDBBindings } from '../bindings';
import { StatusCode } from '../status';

export interface ZipArchiveFileInfo {
    fileIndex: number;
    fileName: string;
    versionMadeBy: number;
    versionNeeded: number;
    bitFlag: number;
    method: number;
    time: string;
    crc32: number;
    sizeCompressed: number;
    sizeUncompressed: number;
    attributesInternal: number;
    attributesExternal: number;
    isDirectory: boolean;
    isEncrypted: boolean;
    isSupported: boolean;
    comment: string;
}

export class ZipArchive {
    _bindings: MinizBindings;
    _url: string;

    constructor(bindings: MinizBindings, url: string) {
        this._bindings = bindings;
        this._url = url;
    }

    getFiles(): ZipArchive[] {
        return this._bindings.getFiles(this._url);
    }
}

export class MinizBindings {
    /// The DuckDB bindings
    _duckdb: DuckDBBindings;

    constructor(duckdb: DuckDBBindings) {
        this._duckdb = duckdb;
    }

    getFiles(url: string): ZipArchive[] {
        const [s, d, n] = this._duckdb.callSRet('duckdb_web_mz_file_stats', ['number', 'string'], [url]);
        if (s !== StatusCode.SUCCESS) {
            throw new Error(this._duckdb.readString(d, n));
        }
        const res = this._duckdb.readString(d, n);
        this._duckdb.dropResponseBuffers();
        return JSON.parse(res) as ZipArchive[];
    }
}
