// Copyright (c) 2020 The DashQL Authors

import { webdb as proto } from '@dashql/proto';
import { Value } from './value';
import { TmpBuffers } from './buffers';
import { RowProxyType, RowProxy, ChunkData } from './proxy';

/** An iterator for row proxies of a chunk iterator. */
export class RowProxyIterator<T extends RowProxy> implements Iterable<RowProxy> {
    private currentRowID: number = -1;
    private currentChunkData?: ChunkData;
    private proxyType: RowProxyType;

    constructor(private chunkIterator: ChunkIterator) {
        this.proxyType = chunkIterator.proxyType();
        if (chunkIterator.nextBlocking()) {
            this.currentChunkData = RowProxyType.indexChunkData(chunkIterator.currentChunk!);
        }
    }

    /* Get the next result from the iterator. */
    next(): IteratorResult<T> {
        const { chunkIterator } = this;

        if (!chunkIterator.currentChunk) {
            return { done: true, value: null };
        }

        this.currentRowID++;

        if (this.currentRowID >= chunkIterator.currentChunk.rowCount()!) {
            // if there is no new chunk or the next chunk has length 0, end
            if (!chunkIterator.nextBlocking() || chunkIterator.currentChunk.rowCount() === 0) {
                return { done: true, value: null };
            }
            this.currentRowID = 0;
            this.currentChunkData = RowProxyType.indexChunkData(chunkIterator.currentChunk);
        }

        return {
            done: false,
            value: this.proxyType!.proxyRow<T>(this.currentChunkData!, this.currentRowID),
        };
    }

    [Symbol.iterator]() {
        return this;
    }
}

export class ColumnIterator<T> implements Iterable<T> {
    idx: number;

    constructor(start: number, private end: number, private value: (idx: number) => T) {
        this.idx = start;
    }

    next(): IteratorResult<T> {
        if (this.idx >= this.end) {
            return { done: true, value: null };
        }

        return {
            done: false,
            value: this.value(this.idx++),
        };
    }

    [Symbol.iterator]() {
        return this;
    }
}

/** A chunk iterator base class */
export abstract class ChunkIterator {
    /* The result buffer */
    _resultBuffer: proto.QueryResult;
    /* The chunk id */
    _currentChunkID: number;
    /* The row id */
    _currentRowID: number;
    /* The current chunk */
    _currentChunk: proto.QueryResultChunk | null;
    /* The current chunk */
    _currentChunkData: ChunkData | null;
    /* The column types */
    _columnTypes: proto.SQLType[];
    /* The row type */
    _proxyType: RowProxyType | null;
    /* The temporary flatbuffer objects */
    _tmp: TmpBuffers;

    public constructor(resultBuffer: proto.QueryResult) {
        this._resultBuffer = resultBuffer;
        this._currentChunkID = -1;
        this._currentChunk = null;
        this._currentRowID = -1;
        this._currentChunkData = null;
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
    /* Get the result */
    public get result() {
        return this._resultBuffer;
    }
    /* Get the column count */
    public get columnCount() {
        return this._columnTypes.length;
    }
    /* Get the column count */
    public get columnTypes() {
        return this._columnTypes;
    }
    /* Get the row count */
    public get rowCount() {
        return this._currentChunk?.rowCount() || 0;
    }
    /* Get the current chunk */
    public get currentChunk() {
        return this._currentChunk;
    }
    /* Get the temporary buffers */
    public get tmp() {
        return this._tmp;
    }
    /* Get the proxy type */
    public proxyType() {
        if (!this._proxyType) {
            this._proxyType = new RowProxyType(this.result);
        }
        return this._proxyType;
    }

    /* Get the next chunk synchronously */
    abstract nextBlocking(): boolean;
    /* Get the next chunk asynchronously */
    abstract nextAsync(): Promise<boolean>;

    /* Build the row proxies for this chunk */
    public collect<T extends RowProxy>(out: T[] = []): T[] {
        const proxyType = this.proxyType();
        return proxyType.proxyChunkRowsArray<T>(this.currentChunk, out);
    }

    /* Iterate over row proxies across all chunks */
    public iter<T extends RowProxy>(): Iterable<T> {
        return new RowProxyIterator<T>(this);
    }

    /* Build row proxies for across all chunks */
    public collectAllBlocking<T extends RowProxy>(out: T[] = []): T[] {
        const proxyType = this.proxyType();
        while (this.nextBlocking()) {
            proxyType.proxyChunkRowsArray<T>(this.currentChunk, out);
        }
        return out;
    }

    /* Build row proxy partitions across all chunks */
    public collectPartitionsBlocking<T extends RowProxy>(out: T[][] = []): T[][] {
        const proxyType = this.proxyType();
        let current: T[] = [];
        while (this.nextBlocking()) {
            const rows = proxyType.proxyChunkRowsArray<T>(this.currentChunk);
            const bounds = this.currentChunk?.partitionBoundariesArray();
            if (!bounds || bounds.length < rows.length) {
                current = current.concat(rows);
                continue;
            }
            for (let i = 0; i < rows.length; ++i) {
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

    /* Read a value of a row */
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

    /* Iterate over a number column */
    public iterateNumberColumn(cid: number, ofs: number = 0, limit: number = 0): Iterable<number | null> {
        if (cid >= this.columnCount) {
            throw Error('column index out of bounds');
        }
        let c = this.currentChunk?.columns(cid, this.tmp.vector);
        if (c == null) {
            return [];
        }
        // XXX other types
        if (c.variantType() != proto.VectorVariant.VectorF64) {
            return [];
        }
        let v = c.variant(this.tmp.vectorF64)!;
        const a: Float64Array | null = v.valuesArray();
        const n: Int8Array | null = v.nullMaskArray();
        if (a == null) return [];
        const lb = ofs;
        const ub = limit > 0 ? Math.min(lb + limit, a.length) : a.length;

        return new ColumnIterator(ofs, ub, n != null ? (i: number) => (n[i] ? null : a[i]) : (i: number) => a[i]);
    }

    /* Iterate over a boolean column */
    public iterateBooleanColumn(cid: number, ofs: number = 0, limit: number = 0): Iterable<boolean | null> {
        if (cid >= this.columnCount) {
            throw Error('column index out of bounds');
        }
        let c = this.currentChunk?.columns(cid, this.tmp.vector);
        if (c == null) {
            return [];
        }
        // XXX other types
        if (c.variantType() != proto.VectorVariant.VectorU8) {
            return [];
        }
        let v = c.variant(this.tmp.vectorU8)!;
        const a: Uint8Array | null = v.valuesArray();
        const n: Int8Array | null = v.nullMaskArray();
        if (a == null) return [];
        const lb = ofs;
        const ub = limit > 0 ? Math.min(lb + limit, a.length) : a.length;

        return new ColumnIterator(
            ofs,
            ub,
            n != null ? (i: number) => (n[i] ? null : a[i] != 0) : (i: number) => a[i] != 0,
        );
    }

    /* Iterate over a string column */
    public iterateStringColumn(cid: number, ofs: number = 0, limit: number = 0): Iterable<string | null> {
        if (cid >= this.columnCount) {
            throw Error('column index out of bounds');
        }
        let c = this.currentChunk?.columns(cid, this.tmp.vector);
        if (c == null) {
            return [];
        }
        // XXX other types
        if (c.variantType() != proto.VectorVariant.VectorString) {
            return [];
        }
        let v = c.variant(this.tmp.vectorString)!;
        const n: Int8Array | null = v.nullMaskArray();
        const lb = ofs;
        const ub = limit > 0 ? Math.min(lb + limit, v.valuesLength()) : v.valuesLength();

        return new ColumnIterator(
            ofs,
            ub,
            n != null ? (i: number) => (n[i] ? null : v.values(i)) : (i: number) => v.values(i),
        );
    }

    /* Iterate over a bigint column */
    public iterateBigIntColumn(cid: number, ofs: number = 0, limit: number = 0): Iterable<bigint | null> {
        if (cid >= this.columnCount) {
            throw Error('column index out of bounds');
        }
        let c = this.currentChunk?.columns(cid, this.tmp.vector);
        if (c == null) {
            return [];
        }
        // XXX other types
        if (c.variantType() != proto.VectorVariant.VectorI64) {
            return [];
        }

        let v = c.variant(this.tmp.vectorI64)!;
        const n: Int8Array | null = v.nullMaskArray();
        const lb = ofs;
        const ub = limit > 0 ? Math.min(lb + limit, v.valuesLength()) : v.valuesLength();

        return new ColumnIterator(
            ofs,
            ub,
            n != null
                ? (i: number) => (n[i] ? null : BigInt(v.values(i)!.low))
                : (i: number) => BigInt(v.values(i)!.low),
        );
    }

    /* Iterate over a hugeint column */
    public iterateHugeIntColumn(cid: number, ofs: number = 0, limit: number = 0): Iterable<bigint | null> {
        if (cid >= this.columnCount) {
            throw Error('column index out of bounds');
        }
        let c = this.currentChunk?.columns(cid, this.tmp.vector);
        if (c == null) {
            return [];
        }
        // XXX other types
        if (c.variantType() != proto.VectorVariant.VectorI128) {
            return [];
        }

        const bigintConverter = (raw: proto.I128): bigint =>
            (BigInt(raw.upper().low) << BigInt(64)) | BigInt(raw.lower().low);

        let v = c.variant(this.tmp.vectorI128)!;
        const n: Int8Array | null = v.nullMaskArray();
        const lb = ofs;
        const ub = limit > 0 ? Math.min(lb + limit, v.valuesLength()) : v.valuesLength();

        return new ColumnIterator(
            ofs,
            ub,
            n != null
                ? (i: number) => (n[i] ? null : bigintConverter(v.values(i)!))
                : (i: number) => bigintConverter(v.values(i)!),
        );
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
