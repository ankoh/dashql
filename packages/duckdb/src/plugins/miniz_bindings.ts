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
    _archiveID: number;

    constructor(bindings: MinizBindings, archiveID: number) {
        this._bindings = bindings;
        this._archiveID = archiveID;
    }

    getFileStats(): ZipArchiveFileInfo[] {
        return this._bindings.getFiles(this._archiveID);
    }
}

export class MinizBindings {
    /// The DuckDB bindings
    _duckdb: DuckDBBindings;

    constructor(duckdb: DuckDBBindings) {
        this._duckdb = duckdb;
    }

    public open(blobID: number): ZipArchive {
        const [s, d, n] = this._duckdb.callSRet('duckdb_web_minz_open', ['number', 'number'], [blobID]);
        if (s !== StatusCode.SUCCESS) {
            throw new Error(this._duckdb.readString(d, n));
        }
        this._duckdb.dropResponseBuffers();
        return new ZipArchive(this, d);
    }

    public getFiles(archiveID: number): ZipArchiveFileInfo[] {
        const [s, d, n] = this._duckdb.callSRet('duckdb_web_miniz_file_stats', ['number'], [archiveID]);
        if (s !== StatusCode.SUCCESS) {
            throw new Error(this._duckdb.readString(d, n));
        }
        const res = this._duckdb.readString(d, n);
        this._duckdb.dropResponseBuffers();
        return JSON.parse(res) as ZipArchiveFileInfo[];
    }
}
