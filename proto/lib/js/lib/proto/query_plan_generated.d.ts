import { flatbuffers } from "flatbuffers";
/**
 * @enum {number}
 */
export declare enum LogicalOperatorType {
    OP_INVALID = 0,
    OP_PROJECTION = 1,
    OP_FILTER = 2,
    OP_AGGREGATE_AND_GROUP_BY = 3,
    OP_WINDOW = 4,
    OP_UNNEST = 5,
    OP_LIMIT = 6,
    OP_ORDER_BY = 7,
    OP_TOP_N = 8,
    OP_COPY_FROM_FILE = 9,
    OP_COPY_TO_FILE = 10,
    OP_DISTINCT = 11,
    OP_INDEX_SCAN = 12,
    OP_GET = 13,
    OP_CHUNK_GET = 14,
    OP_DELIM_GET = 15,
    OP_EXPRESSION_GET = 16,
    OP_TABLE_FUNCTION = 17,
    OP_EMPTY_RESULT = 18,
    OP_CTE_REF = 19,
    OP_JOIN = 20,
    OP_DELIM_JOIN = 21,
    OP_COMPARISON_JOIN = 22,
    OP_ANY_JOIN = 23,
    OP_CROSS_PRODUCT = 24,
    OP_UNION = 25,
    OP_EXCEPT = 26,
    OP_INTERSECT = 27,
    OP_RECURSIVE_CTE = 28,
    OP_INSERT = 29,
    OP_DELETE = 30,
    OP_UPDATE = 31,
    OP_ALTER = 32,
    OP_CREATE_TABLE = 33,
    OP_CREATE_INDEX = 34,
    OP_CREATE_SEQUENCE = 35,
    OP_CREATE_VIEW = 36,
    OP_CREATE_SCHEMA = 37,
    OP_DROP = 38,
    OP_PRAGMA = 39,
    OP_TRANSACTION = 40,
    OP_EXPLAIN = 41,
    OP_PREPARE = 42,
    OP_EXECUTE = 43,
    OP_VACUUM = 44
}
/**
 * @constructor
 */
export declare class QueryPlan {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    /**
     * @param number i
     * @param flatbuffers.ByteBuffer bb
     * @returns QueryPlan
     */
    __init(i: number, bb: flatbuffers.ByteBuffer): QueryPlan;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param QueryPlan= obj
     * @returns QueryPlan
     */
    static getRootAsQueryPlan(bb: flatbuffers.ByteBuffer, obj?: QueryPlan): QueryPlan;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param QueryPlan= obj
     * @returns QueryPlan
     */
    static getSizePrefixedRootAsQueryPlan(bb: flatbuffers.ByteBuffer, obj?: QueryPlan): QueryPlan;
    /**
     * @param number index
     * @returns flatbuffers.Long
     */
    operatorChildren(index: number): flatbuffers.Long | null;
    /**
     * @returns number
     */
    operatorChildrenLength(): number;
    /**
     * @param number index
     * @returns flatbuffers.Long
     */
    operatorChildOffsets(index: number): flatbuffers.Long | null;
    /**
     * @returns number
     */
    operatorChildOffsetsLength(): number;
    /**
     * @param number index
     * @returns LogicalOperatorType
     */
    operatorTypes(index: number): LogicalOperatorType | null;
    /**
     * @returns number
     */
    operatorTypesLength(): number;
    /**
     * @returns Uint8Array
     */
    operatorTypesArray(): Uint8Array | null;
    /**
     * @param flatbuffers.Builder builder
     */
    static startQueryPlan(builder: flatbuffers.Builder): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset operatorChildrenOffset
     */
    static addOperatorChildren(builder: flatbuffers.Builder, operatorChildrenOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<flatbuffers.Long> data
     * @returns flatbuffers.Offset
     */
    static createOperatorChildrenVector(builder: flatbuffers.Builder, data: flatbuffers.Long[]): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startOperatorChildrenVector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset operatorChildOffsetsOffset
     */
    static addOperatorChildOffsets(builder: flatbuffers.Builder, operatorChildOffsetsOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<flatbuffers.Long> data
     * @returns flatbuffers.Offset
     */
    static createOperatorChildOffsetsVector(builder: flatbuffers.Builder, data: flatbuffers.Long[]): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startOperatorChildOffsetsVector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset operatorTypesOffset
     */
    static addOperatorTypes(builder: flatbuffers.Builder, operatorTypesOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<LogicalOperatorType> data
     * @returns flatbuffers.Offset
     */
    static createOperatorTypesVector(builder: flatbuffers.Builder, data: LogicalOperatorType[]): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startOperatorTypesVector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @returns flatbuffers.Offset
     */
    static endQueryPlan(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createQueryPlan(builder: flatbuffers.Builder, operatorChildrenOffset: flatbuffers.Offset, operatorChildOffsetsOffset: flatbuffers.Offset, operatorTypesOffset: flatbuffers.Offset): flatbuffers.Offset;
}
