import { flatbuffers } from "flatbuffers";
import * as NS4548942826317249085 from "./sql_type_generated";
import * as NS6450534610542961714 from "./query_plan_generated";
/**
 * @enum {number}
 */
export declare enum RawTypeID {
    INVALID = 0,
    BOOLEAN = 1,
    TINYINT = 2,
    SMALLINT = 3,
    INTEGER = 4,
    BIGINT = 5,
    HASH = 6,
    POINTER = 7,
    FLOAT = 8,
    DOUBLE = 9,
    VARCHAR = 10,
    VARBINARY = 11
}
/**
 * @constructor
 */
export declare class QueryResultColumn {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    /**
     * @param number i
     * @param flatbuffers.ByteBuffer bb
     * @returns QueryResultColumn
     */
    __init(i: number, bb: flatbuffers.ByteBuffer): QueryResultColumn;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param QueryResultColumn= obj
     * @returns QueryResultColumn
     */
    static getRootAsQueryResultColumn(bb: flatbuffers.ByteBuffer, obj?: QueryResultColumn): QueryResultColumn;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param QueryResultColumn= obj
     * @returns QueryResultColumn
     */
    static getSizePrefixedRootAsQueryResultColumn(bb: flatbuffers.ByteBuffer, obj?: QueryResultColumn): QueryResultColumn;
    /**
     * @returns RawTypeID
     */
    typeId(): RawTypeID;
    /**
     * @param number index
     * @returns boolean
     */
    nullMask(index: number): boolean | null;
    /**
     * @returns number
     */
    nullMaskLength(): number;
    /**
     * @returns Int8Array
     */
    nullMaskArray(): Int8Array | null;
    /**
     * @param number index
     * @returns number
     */
    rowsU8(index: number): number | null;
    /**
     * @returns number
     */
    rowsU8Length(): number;
    /**
     * @returns Uint8Array
     */
    rowsU8Array(): Uint8Array | null;
    /**
     * @param number index
     * @returns number
     */
    rowsI16(index: number): number | null;
    /**
     * @returns number
     */
    rowsI16Length(): number;
    /**
     * @returns Int16Array
     */
    rowsI16Array(): Int16Array | null;
    /**
     * @param number index
     * @returns number
     */
    rowsU16(index: number): number | null;
    /**
     * @returns number
     */
    rowsU16Length(): number;
    /**
     * @returns Uint16Array
     */
    rowsU16Array(): Uint16Array | null;
    /**
     * @param number index
     * @returns number
     */
    rowsI32(index: number): number | null;
    /**
     * @returns number
     */
    rowsI32Length(): number;
    /**
     * @returns Int32Array
     */
    rowsI32Array(): Int32Array | null;
    /**
     * @param number index
     * @returns flatbuffers.Long
     */
    rowsI64(index: number): flatbuffers.Long | null;
    /**
     * @returns number
     */
    rowsI64Length(): number;
    /**
     * @param number index
     * @returns flatbuffers.Long
     */
    rowsU64(index: number): flatbuffers.Long | null;
    /**
     * @returns number
     */
    rowsU64Length(): number;
    /**
     * @param number index
     * @returns number
     */
    rowsF32(index: number): number | null;
    /**
     * @returns number
     */
    rowsF32Length(): number;
    /**
     * @returns Float32Array
     */
    rowsF32Array(): Float32Array | null;
    /**
     * @param number index
     * @returns number
     */
    rowsF64(index: number): number | null;
    /**
     * @returns number
     */
    rowsF64Length(): number;
    /**
     * @returns Float64Array
     */
    rowsF64Array(): Float64Array | null;
    /**
     * @param number index
     * @param flatbuffers.Encoding= optionalEncoding
     * @returns string|Uint8Array
     */
    rowsString(index: number): string;
    rowsString(index: number, optionalEncoding: flatbuffers.Encoding): string | Uint8Array;
    /**
     * @returns number
     */
    rowsStringLength(): number;
    /**
     * @param flatbuffers.Builder builder
     */
    static startQueryResultColumn(builder: flatbuffers.Builder): void;
    /**
     * @param flatbuffers.Builder builder
     * @param RawTypeID typeId
     */
    static addTypeId(builder: flatbuffers.Builder, typeId: RawTypeID): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset nullMaskOffset
     */
    static addNullMask(builder: flatbuffers.Builder, nullMaskOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<boolean> data
     * @returns flatbuffers.Offset
     */
    static createNullMaskVector(builder: flatbuffers.Builder, data: boolean[]): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startNullMaskVector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset rowsU8Offset
     */
    static addRowsU8(builder: flatbuffers.Builder, rowsU8Offset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<number> data
     * @returns flatbuffers.Offset
     */
    static createRowsU8Vector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startRowsU8Vector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset rowsI16Offset
     */
    static addRowsI16(builder: flatbuffers.Builder, rowsI16Offset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<number> data
     * @returns flatbuffers.Offset
     */
    static createRowsI16Vector(builder: flatbuffers.Builder, data: number[] | Int16Array): flatbuffers.Offset;
    /**
     * @deprecated This Uint8Array overload will be removed in the future.
     */
    static createRowsI16Vector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startRowsI16Vector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset rowsU16Offset
     */
    static addRowsU16(builder: flatbuffers.Builder, rowsU16Offset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<number> data
     * @returns flatbuffers.Offset
     */
    static createRowsU16Vector(builder: flatbuffers.Builder, data: number[] | Uint16Array): flatbuffers.Offset;
    /**
     * @deprecated This Uint8Array overload will be removed in the future.
     */
    static createRowsU16Vector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startRowsU16Vector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset rowsI32Offset
     */
    static addRowsI32(builder: flatbuffers.Builder, rowsI32Offset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<number> data
     * @returns flatbuffers.Offset
     */
    static createRowsI32Vector(builder: flatbuffers.Builder, data: number[] | Int32Array): flatbuffers.Offset;
    /**
     * @deprecated This Uint8Array overload will be removed in the future.
     */
    static createRowsI32Vector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startRowsI32Vector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset rowsI64Offset
     */
    static addRowsI64(builder: flatbuffers.Builder, rowsI64Offset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<flatbuffers.Long> data
     * @returns flatbuffers.Offset
     */
    static createRowsI64Vector(builder: flatbuffers.Builder, data: flatbuffers.Long[]): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startRowsI64Vector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset rowsU64Offset
     */
    static addRowsU64(builder: flatbuffers.Builder, rowsU64Offset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<flatbuffers.Long> data
     * @returns flatbuffers.Offset
     */
    static createRowsU64Vector(builder: flatbuffers.Builder, data: flatbuffers.Long[]): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startRowsU64Vector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset rowsF32Offset
     */
    static addRowsF32(builder: flatbuffers.Builder, rowsF32Offset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<number> data
     * @returns flatbuffers.Offset
     */
    static createRowsF32Vector(builder: flatbuffers.Builder, data: number[] | Float32Array): flatbuffers.Offset;
    /**
     * @deprecated This Uint8Array overload will be removed in the future.
     */
    static createRowsF32Vector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startRowsF32Vector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset rowsF64Offset
     */
    static addRowsF64(builder: flatbuffers.Builder, rowsF64Offset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<number> data
     * @returns flatbuffers.Offset
     */
    static createRowsF64Vector(builder: flatbuffers.Builder, data: number[] | Float64Array): flatbuffers.Offset;
    /**
     * @deprecated This Uint8Array overload will be removed in the future.
     */
    static createRowsF64Vector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startRowsF64Vector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset rowsStringOffset
     */
    static addRowsString(builder: flatbuffers.Builder, rowsStringOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<flatbuffers.Offset> data
     * @returns flatbuffers.Offset
     */
    static createRowsStringVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startRowsStringVector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @returns flatbuffers.Offset
     */
    static endQueryResultColumn(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createQueryResultColumn(builder: flatbuffers.Builder, typeId: RawTypeID, nullMaskOffset: flatbuffers.Offset, rowsU8Offset: flatbuffers.Offset, rowsI16Offset: flatbuffers.Offset, rowsU16Offset: flatbuffers.Offset, rowsI32Offset: flatbuffers.Offset, rowsI64Offset: flatbuffers.Offset, rowsU64Offset: flatbuffers.Offset, rowsF32Offset: flatbuffers.Offset, rowsF64Offset: flatbuffers.Offset, rowsStringOffset: flatbuffers.Offset): flatbuffers.Offset;
}
/**
 * @constructor
 */
export declare class QueryResultChunk {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    /**
     * @param number i
     * @param flatbuffers.ByteBuffer bb
     * @returns QueryResultChunk
     */
    __init(i: number, bb: flatbuffers.ByteBuffer): QueryResultChunk;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param QueryResultChunk= obj
     * @returns QueryResultChunk
     */
    static getRootAsQueryResultChunk(bb: flatbuffers.ByteBuffer, obj?: QueryResultChunk): QueryResultChunk;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param QueryResultChunk= obj
     * @returns QueryResultChunk
     */
    static getSizePrefixedRootAsQueryResultChunk(bb: flatbuffers.ByteBuffer, obj?: QueryResultChunk): QueryResultChunk;
    /**
     * @param number index
     * @param QueryResultColumn= obj
     * @returns QueryResultColumn
     */
    columns(index: number, obj?: QueryResultColumn): QueryResultColumn | null;
    /**
     * @returns number
     */
    columnsLength(): number;
    /**
     * @param flatbuffers.Builder builder
     */
    static startQueryResultChunk(builder: flatbuffers.Builder): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset columnsOffset
     */
    static addColumns(builder: flatbuffers.Builder, columnsOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<flatbuffers.Offset> data
     * @returns flatbuffers.Offset
     */
    static createColumnsVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startColumnsVector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @returns flatbuffers.Offset
     */
    static endQueryResultChunk(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createQueryResultChunk(builder: flatbuffers.Builder, columnsOffset: flatbuffers.Offset): flatbuffers.Offset;
}
/**
 * @constructor
 */
export declare class QueryResultHeader {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    /**
     * @param number i
     * @param flatbuffers.ByteBuffer bb
     * @returns QueryResultHeader
     */
    __init(i: number, bb: flatbuffers.ByteBuffer): QueryResultHeader;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param QueryResultHeader= obj
     * @returns QueryResultHeader
     */
    static getRootAsQueryResultHeader(bb: flatbuffers.ByteBuffer, obj?: QueryResultHeader): QueryResultHeader;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param QueryResultHeader= obj
     * @returns QueryResultHeader
     */
    static getSizePrefixedRootAsQueryResultHeader(bb: flatbuffers.ByteBuffer, obj?: QueryResultHeader): QueryResultHeader;
    /**
     * @returns flatbuffers.Long
     */
    queryId(): flatbuffers.Long;
    /**
     * @param QueryPlan= obj
     * @returns QueryPlan|null
     */
    queryPlan(obj?: NS6450534610542961714.QueryPlan): NS6450534610542961714.QueryPlan | null;
    /**
     * @param number index
     * @returns RawTypeID
     */
    columnRawTypes(index: number): RawTypeID | null;
    /**
     * @returns number
     */
    columnRawTypesLength(): number;
    /**
     * @returns Uint8Array
     */
    columnRawTypesArray(): Uint8Array | null;
    /**
     * @param number index
     * @param SQLType= obj
     * @returns SQLType
     */
    columnSqlTypes(index: number, obj?: NS4548942826317249085.SQLType): NS4548942826317249085.SQLType | null;
    /**
     * @returns number
     */
    columnSqlTypesLength(): number;
    /**
     * @param number index
     * @param flatbuffers.Encoding= optionalEncoding
     * @returns string|Uint8Array
     */
    columnNames(index: number): string;
    columnNames(index: number, optionalEncoding: flatbuffers.Encoding): string | Uint8Array;
    /**
     * @returns number
     */
    columnNamesLength(): number;
    /**
     * @param number index
     * @param QueryResultChunk= obj
     * @returns QueryResultChunk
     */
    dataChunks(index: number, obj?: QueryResultChunk): QueryResultChunk | null;
    /**
     * @returns number
     */
    dataChunksLength(): number;
    /**
     * @param flatbuffers.Builder builder
     */
    static startQueryResultHeader(builder: flatbuffers.Builder): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Long queryId
     */
    static addQueryId(builder: flatbuffers.Builder, queryId: flatbuffers.Long): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset queryPlanOffset
     */
    static addQueryPlan(builder: flatbuffers.Builder, queryPlanOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset columnRawTypesOffset
     */
    static addColumnRawTypes(builder: flatbuffers.Builder, columnRawTypesOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<RawTypeID> data
     * @returns flatbuffers.Offset
     */
    static createColumnRawTypesVector(builder: flatbuffers.Builder, data: RawTypeID[]): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startColumnRawTypesVector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset columnSqlTypesOffset
     */
    static addColumnSqlTypes(builder: flatbuffers.Builder, columnSqlTypesOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<flatbuffers.Offset> data
     * @returns flatbuffers.Offset
     */
    static createColumnSqlTypesVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startColumnSqlTypesVector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset columnNamesOffset
     */
    static addColumnNames(builder: flatbuffers.Builder, columnNamesOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<flatbuffers.Offset> data
     * @returns flatbuffers.Offset
     */
    static createColumnNamesVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startColumnNamesVector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset dataChunksOffset
     */
    static addDataChunks(builder: flatbuffers.Builder, dataChunksOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<flatbuffers.Offset> data
     * @returns flatbuffers.Offset
     */
    static createDataChunksVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startDataChunksVector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @returns flatbuffers.Offset
     */
    static endQueryResultHeader(builder: flatbuffers.Builder): flatbuffers.Offset;
}
