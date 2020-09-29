import { flatbuffers } from "flatbuffers";
/**
 * @enum {number}
 */
export declare enum SQLTypeID {
    SQL_INVALID = 0,
    SQL_NULL = 1,
    SQL_UNKNOWN = 2,
    SQL_ANY = 3,
    SQL_BOOLEAN = 10,
    SQL_TINYINT = 11,
    SQL_SMALLINT = 12,
    SQL_INTEGER = 13,
    SQL_BIGINT = 14,
    SQL_DATE = 15,
    SQL_TIME = 16,
    SQL_TIMESTAMP = 17,
    SQL_FLOAT = 18,
    SQL_DOUBLE = 19,
    SQL_DECIMAL = 20,
    SQL_CHAR = 21,
    SQL_VARCHAR = 22,
    SQL_VARBINARY = 23,
    SQL_BLOB = 24,
    SQL_STRUCT = 100,
    SQL_LIST = 101
}
/**
 * @constructor
 */
export declare class SQLType {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    /**
     * @param number i
     * @param flatbuffers.ByteBuffer bb
     * @returns SQLType
     */
    __init(i: number, bb: flatbuffers.ByteBuffer): SQLType;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param SQLType= obj
     * @returns SQLType
     */
    static getRootAsSQLType(bb: flatbuffers.ByteBuffer, obj?: SQLType): SQLType;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param SQLType= obj
     * @returns SQLType
     */
    static getSizePrefixedRootAsSQLType(bb: flatbuffers.ByteBuffer, obj?: SQLType): SQLType;
    /**
     * @returns SQLTypeID
     */
    typeId(): SQLTypeID;
    /**
     * @returns number
     */
    width(): number;
    /**
     * @returns number
     */
    scale(): number;
    /**
     * @param flatbuffers.Encoding= optionalEncoding
     * @returns string|Uint8Array|null
     */
    collation(): string | null;
    collation(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * @param flatbuffers.Builder builder
     */
    static startSQLType(builder: flatbuffers.Builder): void;
    /**
     * @param flatbuffers.Builder builder
     * @param SQLTypeID typeId
     */
    static addTypeId(builder: flatbuffers.Builder, typeId: SQLTypeID): void;
    /**
     * @param flatbuffers.Builder builder
     * @param number width
     */
    static addWidth(builder: flatbuffers.Builder, width: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param number scale
     */
    static addScale(builder: flatbuffers.Builder, scale: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset collationOffset
     */
    static addCollation(builder: flatbuffers.Builder, collationOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @returns flatbuffers.Offset
     */
    static endSQLType(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createSQLType(builder: flatbuffers.Builder, typeId: SQLTypeID, width: number, scale: number, collationOffset: flatbuffers.Offset): flatbuffers.Offset;
}
