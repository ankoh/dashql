// Copyright (c) 2020 The DashQL Authors

import { DuckDBBindings } from '../bindings';
import { StatusCode } from '../status';

export interface ZipArchiveEntryInfo {
    fileIndex: number;
    fileName: string;
    versionMadeBy: number;
    versionNeeded: number;
    headerOffset: number;
    crc32: number;
    bitFlag: number;
    method: number;
    sizeCompressed: number;
    sizeUncompressed: number;
    attributesInternal: number;
    attributesExternal: number;
    isDirectory: boolean;
    isEncrypted: boolean;
    isSupported: boolean;
    comment: string;
}

export class ZipArchiveEntry {
    _bindings: ZipBindings;
    _archiveID: number;
    _info: ZipArchiveEntryInfo;

    constructor(bindings: ZipBindings, archiveID: number, info: ZipArchiveEntryInfo) {
        this._bindings = bindings;
        this._archiveID = archiveID;
        this._info = info;
    }
}

export class ZipArchive {
    _bindings: ZipBindings;
    _archiveID: number;

    constructor(bindings: ZipBindings, archiveID: number) {
        this._bindings = bindings;
        this._archiveID = archiveID;
    }

    getEntryCount(): number {
        return this._bindings.getEntryCount(this._archiveID);
    }

    getEntry(entryID: number): ZipArchiveEntryInfo {
        return this._bindings.getEntryInfo(this._archiveID, entryID);
    }
}

export class ZipBindings {
    /// The DuckDB bindings
    _duckdb: DuckDBBindings;

    constructor(duckdb: DuckDBBindings) {
        this._duckdb = duckdb;
    }

    public loadFile(path: string): ZipArchive {
        const [s, d, n] = this._duckdb.callSRet('duckdb_web_zip_load_file', ['number', 'string'], [path]);
        if (s !== StatusCode.SUCCESS) {
            throw new Error(this._duckdb.readString(d, n));
        }
        this._duckdb.dropResponseBuffers();
        return new ZipArchive(this, d);
    }

    public getEntryCount(archiveID: number): number {
        const [s, d, n] = this._duckdb.callSRet('duckdb_web_zip_read_entry_count', ['number'], [archiveID]);
        if (s !== StatusCode.SUCCESS) {
            throw new Error(this._duckdb.readString(d, n));
        }
        this._duckdb.dropResponseBuffers();
        return d;
    }

    public getEntryInfo(archiveID: number, entryID: number): ZipArchiveEntryInfo {
        const [s, d, n] = this._duckdb.callSRet(
            'duckdb_web_zip_read_entry_info',
            ['number', 'number'],
            [archiveID, entryID],
        );
        if (s !== StatusCode.SUCCESS) {
            throw new Error(this._duckdb.readString(d, n));
        }
        const res = this._duckdb.readString(d, n);
        this._duckdb.dropResponseBuffers();
        return JSON.parse(res) as ZipArchiveEntryInfo;
    }
}
