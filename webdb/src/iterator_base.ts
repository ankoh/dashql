// Copyright (c) 2020 The DashQL Authors

import { webdb as proto } from '@dashql/proto';
import { Value } from './value';
import { TmpBuffers } from './buffers';
import { RowProxyType, RowProxy } from './proxy';

/// A chunk iterator base class
export abstract class ChunkIterator {
    /// The result buffer
    _resultBuffer: proto.QueryResult;
    /// The chunk id
    _currentChunkID: number;
    /// The current chunk
    _currentChunk: proto.QueryResultChunk | null;
    /// The column types
    _columnTypes: proto.SQLType[];
    /// The row type
    _proxyType: RowProxyType | null;
    /// The temporary flatbuffer objects
    _tmp: TmpBuffers;

    /// Constructor
    public constructor(resultBuffer: proto.QueryResult) {
        this._resultBuffer = resultBuffer;
        this._currentChunkID = -1;
        this._currentChunk = null;
        this._columnTypes = new Array<proto.SQLType>();
        this._proxyType = null;
        this._tmp = new TmpBuffers();

        // Collect the column types
        for (let i = 0; i < this.result.columnTypesLength(); ++i) {
            let t = new proto.SQLType();
            this.result.columnTypes(i, t);
            this._columnTypes.push(t);
        }
    }
    /// Get the result
    public get result() {
        return this._resultBuffer;
    }
    /// Get the column count
    public get columnCount() {
        return this._columnTypes.length;
    }
    /// Get the column count
    public get columnTypes() {
        return this._columnTypes;
    }
    /// Get the row count
    public get rowCount() {
        return this._currentChunk?.rowCount() || 0;
    }
    /// Get the current chunk
    public get currentChunk() {
        return this._currentChunk;
    }
    /// Get the temporary buffers
    public get tmp() {
        return this._tmp;
    }

    /// Get the next chunk synchrnously
    abstract nextBlocking(): boolean;
    /// Get the next chunk asynchrnously
    abstract nextAsync(): Promise<boolean>;

    /// Collect exactly one entry
    public collectOne<T extends RowProxy>(): T {
        if (!this._proxyType) {
            this._proxyType = new RowProxyType(this.result);
        }
        return this._proxyType.proxyChunkRow<T>(this.currentChunk);
    }

    /// Build the row proxies
    public collect<T extends RowProxy>(out: T[] = []): T[] {
        if (!this._proxyType) {
            this._proxyType = new RowProxyType(this.result);
        }
        return this._proxyType.proxyChunkRows<T>(this.currentChunk, out);
    }

    /// Build row proxies for across all chunks
    public collectAllBlocking<T extends RowProxy>(out: T[] = []): T[] {
        if (!this._proxyType) {
            this._proxyType = new RowProxyType(this.result);
        }
        while (this.nextBlocking()) {
            this._proxyType.proxyChunkRows<T>(this.currentChunk, out);
        }
        return out;
    }

    /// Build row proxy partitions across all chunks
    public collectPartitionsBlocking<T extends RowProxy>(out: T[][] = []): T[][] {
        if (!this._proxyType) {
            this._proxyType = new RowProxyType(this.result);
        }
        let current: T[] = [];
        while (this.nextBlocking()) {
            const rows = this._proxyType.proxyChunkRows<T>(this.currentChunk);
            const bounds = this.currentChunk?.partitionBoundariesArray();
            if (!bounds) {
                current = current.concat(rows);
                continue;
            }
            for (let i = 0; i < bounds.length; ++i) {
                if (bounds[i]) {
                    if (current.length > 0) {
                        out.push(current);
                    }
                    current = [rows[i]];
                } else {
                    current.push(rows[i]);
                }
            }
        }
        if (current.length > 0) {
            out.push(current);
        }
        return out;
    }

    /// Read a value of a row
    public readValue(rid = 0, cid: number = 0, v: Value = new Value()): Value {
        v.sqlType = this.columnTypes[cid];
        let c = this.currentChunk?.columns(cid, this.tmp.vector);
        if (c == null) {
            v.setNull();
            return v;
        }
        switch (c.variantType()) {
            case proto.VectorVariant.NONE:
                break;
            case proto.VectorVariant.VectorU8:
                c.variant(this.tmp.vectorU8);
                v.setNumber(this.tmp.vectorU8.values(rid)!);
                v.setNull(this.tmp.vectorU8.nullMask(rid)!);
                break;
            case proto.VectorVariant.VectorI64:
                c.variant(this.tmp.vectorI64);
                v.setLong(this.tmp.vectorI64.values(rid)!);
                v.setNull(this.tmp.vectorI64.nullMask(rid)!);
                break;
            case proto.VectorVariant.VectorF64:
                c.variant(this.tmp.vectorF64);
                v.setNumber(this.tmp.vectorF64.values(rid)!);
                v.setNull(this.tmp.vectorF64.nullMask(rid)!);
                break;
            case proto.VectorVariant.VectorI128:
                c.variant(this.tmp.vectorI128);
                v.setI128(this.tmp.vectorI128.values(rid)!);
                v.setNull(this.tmp.vectorI128.nullMask(rid)!);
                break;
            case proto.VectorVariant.VectorInterval:
                c.variant(this.tmp.vectorInterval);
                v.setInterval(this.tmp.vectorInterval.values(rid)!);
                v.setNull(this.tmp.vectorInterval.nullMask(rid)!);
                break;
            case proto.VectorVariant.VectorString:
                c.variant(this.tmp.vectorString);
                v.setString(this.tmp.vectorString.values(rid)!);
                v.setNull(this.tmp.vectorString.nullMask(rid)!);
                break;
        }
        return v;
    }

    /// Iterate over a number column
    public iterateNumberColumn(
        cid: number,
        fn: (row: number, v: number | null) => void,
        ofs: number = 0,
        limit: number = 0,
    ) {
        if (cid >= this.columnCount) {
            throw Error('column index out of bounds');
        }
        let c = this.currentChunk?.columns(cid, this.tmp.vector);
        if (c == null) {
            return;
        }
        // XXX other types
        if (c.variantType() != proto.VectorVariant.VectorF64) {
            return;
        }
        let v = c.variant(this.tmp.vectorF64)!;
        const a: Float64Array | null = v.valuesArray();
        const n: Int8Array | null = v.nullMaskArray();
        if (a == null) return;
        const lb = ofs;
        const ub = limit > 0 ? Math.min(lb + limit, a.length) : a.length;
        if (n != null) {
            for (let i = lb; i < ub; ++i) {
                fn(i, n[i] ? null : a[i]);
            }
        } else {
            for (let i = lb; i < ub; ++i) {
                fn(i, a[i]);
            }
        }
    }

    /// Iterate over a boolean column
    public iterateBooleanColumn(
        cid: number,
        fn: (row: number, v: boolean | null) => void,
        ofs: number = 0,
        limit: number = 0,
    ) {
        if (cid >= this.columnCount) {
            throw Error('column index out of bounds');
        }
        let c = this.currentChunk?.columns(cid, this.tmp.vector);
        if (c == null) {
            return;
        }
        // XXX other types
        if (c.variantType() != proto.VectorVariant.VectorU8) {
            return;
        }
        let v = c.variant(this.tmp.vectorU8)!;
        const a: Uint8Array | null = v.valuesArray();
        const n: Int8Array | null = v.nullMaskArray();
        if (a == null) return;
        const lb = ofs;
        const ub = limit > 0 ? Math.min(lb + limit, a.length) : a.length;
        if (n != null) {
            for (let i = lb; i < ub; ++i) {
                fn(i, n[i] ? null : a[i] != 0);
            }
        } else {
            for (let i = lb; i < ub; ++i) {
                fn(i, a[i] != 0);
            }
        }
    }

    /// Iterate over a string column
    public iterateStringColumn(
        cid: number,
        fn: (row: number, v: string | null) => void,
        ofs: number = 0,
        limit: number = 0,
    ) {
        if (cid >= this.columnCount) {
            throw Error('column index out of bounds');
        }
        let c = this.currentChunk?.columns(cid, this.tmp.vector);
        if (c == null) {
            return;
        }
        // XXX other types
        if (c.variantType() != proto.VectorVariant.VectorString) {
            return;
        }
        let v = c.variant(this.tmp.vectorString)!;
        const n: Int8Array | null = v.nullMaskArray();
        const lb = ofs;
        const ub = limit > 0 ? Math.min(lb + limit, v.valuesLength()) : v.valuesLength();
        if (n != null) {
            for (let i = lb; i < ub; ++i) {
                fn(i, n[i] ? null : v.values(i));
            }
        } else {
            for (let i = lb; i < ub; ++i) {
                fn(i, v.values(i));
            }
        }
    }

    /// Iterate over a bigint column
    public iterateBigIntColumn(
        cid: number,
        fn: (row: number, v: bigint | null) => void,
        ofs: number = 0,
        limit: number = 0,
    ) {
        if (cid >= this.columnCount) {
            throw Error('column index out of bounds');
        }
        let c = this.currentChunk?.columns(cid, this.tmp.vector);
        if (c == null) {
            return;
        }
        // XXX other types
        if (c.variantType() != proto.VectorVariant.VectorI64) {
            return;
        }

        let v = c.variant(this.tmp.vectorI64)!;
        const n: Int8Array | null = v.nullMaskArray();
        const lb = ofs;
        const ub = limit > 0 ? Math.min(lb + limit, v.valuesLength()) : v.valuesLength();
        if (n != null) {
            for (let i = lb; i < ub; ++i) {
                fn(i, n[i] ? null : BigInt(v.values(i)!.low));
            }
        } else {
            for (let i = lb; i < ub; ++i) {
                fn(i, BigInt(v.values(i)!.low));
            }
        }
    }

    /// Iterate over a hugeint column
    public iterateHugeIntColumn(
        cid: number,
        fn: (row: number, v: bigint | null) => void,
        ofs: number = 0,
        limit: number = 0,
    ) {
        if (cid >= this.columnCount) {
            throw Error('column index out of bounds');
        }
        let c = this.currentChunk?.columns(cid, this.tmp.vector);
        if (c == null) {
            return;
        }
        // XXX other types
        if (c.variantType() != proto.VectorVariant.VectorI128) {
            return;
        }

        const bigintConverter = (raw: proto.I128): bigint =>
            (BigInt(raw.upper().low) << BigInt(64)) | BigInt(raw.lower().low);

        let v = c.variant(this.tmp.vectorI128)!;
        const n: Int8Array | null = v.nullMaskArray();
        const lb = ofs;
        const ub = limit > 0 ? Math.min(lb + limit, v.valuesLength()) : v.valuesLength();
        if (n != null) {
            for (let i = lb; i < ub; ++i) {
                fn(i, n[i] ? null : bigintConverter(v.values(i)!));
            }
        } else {
            for (let i = lb; i < ub; ++i) {
                fn(i, bigintConverter(v.values(i)!));
            }
        }
    }

    /// Helper to iterate over a blocking chunk iterator
    public iterateAllBlocking(
        offset: number,
        limit: number,
        fn: (iter: ChunkIterator, start: number, skipHere: number, rowsHere: number) => void,
    ) {
        let skip = offset;
        let remaining = limit;
        let start = 0;

        while (remaining && this.nextBlocking()) {
            const chunkRows = this.currentChunk!.rowCount();
            const skipHere = Math.min(skip, chunkRows);
            skip -= skipHere;
            if (skipHere == chunkRows) {
                continue;
            }
            const rowsHere = Math.min(chunkRows - skipHere, remaining);

            // Run the function
            fn(this, start, skipHere, rowsHere);

            // Advance the chunk start
            start += chunkRows - skipHere;
            remaining -= rowsHere;
        }
    }
}
