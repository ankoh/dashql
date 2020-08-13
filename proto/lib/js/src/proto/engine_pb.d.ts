// package: tigon.proto.engine
// file: engine.proto

import * as jspb from 'google-protobuf';

export class SQLType extends jspb.Message {
    getTypeId(): SQLTypeIDMap[keyof SQLTypeIDMap];
    setTypeId(value: SQLTypeIDMap[keyof SQLTypeIDMap]): void;

    getWidth(): number;
    setWidth(value: number): void;

    getScale(): number;
    setScale(value: number): void;

    getCollation(): string;
    setCollation(value: string): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): SQLType.AsObject;
    static toObject(includeInstance: boolean, msg: SQLType): SQLType.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: SQLType,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): SQLType;
    static deserializeBinaryFromReader(
        message: SQLType,
        reader: jspb.BinaryReader,
    ): SQLType;
}

export namespace SQLType {
    export type AsObject = {
        typeId: SQLTypeIDMap[keyof SQLTypeIDMap];
        width: number;
        scale: number;
        collation: string;
    };
}

export class QueryPlan extends jspb.Message {
    clearOperatorChildrenList(): void;
    getOperatorChildrenList(): Array<number>;
    setOperatorChildrenList(value: Array<number>): void;
    addOperatorChildren(value: number, index?: number): number;

    clearOperatorChildOffsetsList(): void;
    getOperatorChildOffsetsList(): Array<number>;
    setOperatorChildOffsetsList(value: Array<number>): void;
    addOperatorChildOffsets(value: number, index?: number): number;

    clearOperatorTypesList(): void;
    getOperatorTypesList(): Array<
        LogicalOperatorTypeMap[keyof LogicalOperatorTypeMap]
    >;
    setOperatorTypesList(
        value: Array<LogicalOperatorTypeMap[keyof LogicalOperatorTypeMap]>,
    ): void;
    addOperatorTypes(
        value: LogicalOperatorTypeMap[keyof LogicalOperatorTypeMap],
        index?: number,
    ): LogicalOperatorTypeMap[keyof LogicalOperatorTypeMap];

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryPlan.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: QueryPlan,
    ): QueryPlan.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: QueryPlan,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): QueryPlan;
    static deserializeBinaryFromReader(
        message: QueryPlan,
        reader: jspb.BinaryReader,
    ): QueryPlan;
}

export namespace QueryPlan {
    export type AsObject = {
        operatorChildrenList: Array<number>;
        operatorChildOffsetsList: Array<number>;
        operatorTypesList: Array<
            LogicalOperatorTypeMap[keyof LogicalOperatorTypeMap]
        >;
    };
}

export class QueryResultRow extends jspb.Message {
    hasBool(): boolean;
    clearBool(): void;
    getBool(): boolean;
    setBool(value: boolean): void;

    hasI32(): boolean;
    clearI32(): void;
    getI32(): number;
    setI32(value: number): void;

    hasU32(): boolean;
    clearU32(): void;
    getU32(): number;
    setU32(value: number): void;

    hasI64(): boolean;
    clearI64(): void;
    getI64(): number;
    setI64(value: number): void;

    hasU64(): boolean;
    clearU64(): void;
    getU64(): number;
    setU64(value: number): void;

    hasF32(): boolean;
    clearF32(): void;
    getF32(): number;
    setF32(value: number): void;

    hasF64(): boolean;
    clearF64(): void;
    getF64(): number;
    setF64(value: number): void;

    hasStr(): boolean;
    clearStr(): void;
    getStr(): string;
    setStr(value: string): void;

    getValueCase(): QueryResultRow.ValueCase;
    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryResultRow.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: QueryResultRow,
    ): QueryResultRow.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: QueryResultRow,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): QueryResultRow;
    static deserializeBinaryFromReader(
        message: QueryResultRow,
        reader: jspb.BinaryReader,
    ): QueryResultRow;
}

export namespace QueryResultRow {
    export type AsObject = {
        bool: boolean;
        i32: number;
        u32: number;
        i64: number;
        u64: number;
        f32: number;
        f64: number;
        str: string;
    };

    export enum ValueCase {
        VALUE_NOT_SET = 0,
        BOOL = 1,
        I32 = 2,
        U32 = 3,
        I64 = 4,
        U64 = 5,
        F32 = 6,
        F64 = 7,
        STR = 8,
    }
}

export class QueryResultColumn extends jspb.Message {
    getName(): string;
    setName(value: string): void;

    hasType(): boolean;
    clearType(): void;
    getType(): SQLType | undefined;
    setType(value?: SQLType): void;

    clearRowsList(): void;
    getRowsList(): Array<QueryResultRow>;
    setRowsList(value: Array<QueryResultRow>): void;
    addRows(value?: QueryResultRow, index?: number): QueryResultRow;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryResultColumn.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: QueryResultColumn,
    ): QueryResultColumn.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: QueryResultColumn,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): QueryResultColumn;
    static deserializeBinaryFromReader(
        message: QueryResultColumn,
        reader: jspb.BinaryReader,
    ): QueryResultColumn;
}

export namespace QueryResultColumn {
    export type AsObject = {
        name: string;
        type?: SQLType.AsObject;
        rowsList: Array<QueryResultRow.AsObject>;
    };
}

export class QueryResult extends jspb.Message {
    getQueryId(): number;
    setQueryId(value: number): void;

    hasQueryPlan(): boolean;
    clearQueryPlan(): void;
    getQueryPlan(): QueryPlan | undefined;
    setQueryPlan(value?: QueryPlan): void;

    getColumnCount(): number;
    setColumnCount(value: number): void;

    getRowCount(): number;
    setRowCount(value: number): void;

    clearColumnsList(): void;
    getColumnsList(): Array<QueryResultColumn>;
    setColumnsList(value: Array<QueryResultColumn>): void;
    addColumns(value?: QueryResultColumn, index?: number): QueryResultColumn;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryResult.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: QueryResult,
    ): QueryResult.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: QueryResult,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): QueryResult;
    static deserializeBinaryFromReader(
        message: QueryResult,
        reader: jspb.BinaryReader,
    ): QueryResult;
}

export namespace QueryResult {
    export type AsObject = {
        queryId: number;
        queryPlan?: QueryPlan.AsObject;
        columnCount: number;
        rowCount: number;
        columnsList: Array<QueryResultColumn.AsObject>;
    };
}

export interface SQLTypeIDMap {
    SQL_INVALID: 0;
    SQL_NULL: 1;
    SQL_UNKNOWN: 2;
    SQL_ANY: 3;
    SQL_BOOLEAN: 10;
    SQL_TINYINT: 11;
    SQL_SMALLINT: 12;
    SQL_INTEGER: 13;
    SQL_BIGINT: 14;
    SQL_DATE: 15;
    SQL_TIME: 16;
    SQL_TIMESTAMP: 17;
    SQL_FLOAT: 18;
    SQL_DOUBLE: 19;
    SQL_DECIMAL: 20;
    SQL_CHAR: 21;
    SQL_VARCHAR: 22;
    SQL_VARBINARY: 23;
    SQL_BLOB: 24;
    SQL_STRUCT: 100;
    SQL_LIST: 101;
}

export const SQLTypeID: SQLTypeIDMap;

export interface LogicalOperatorTypeMap {
    OP_INVALID: 0;
    OP_PROJECTION: 1;
    OP_FILTER: 2;
    OP_AGGREGATE_AND_GROUP_BY: 3;
    OP_WINDOW: 4;
    OP_UNNEST: 5;
    OP_LIMIT: 6;
    OP_ORDER_BY: 7;
    OP_TOP_N: 8;
    OP_COPY_FROM_FILE: 9;
    OP_COPY_TO_FILE: 10;
    OP_DISTINCT: 11;
    OP_INDEX_SCAN: 12;
    OP_GET: 13;
    OP_CHUNK_GET: 14;
    OP_DELIM_GET: 15;
    OP_EXPRESSION_GET: 16;
    OP_TABLE_FUNCTION: 17;
    OP_EMPTY_RESULT: 18;
    OP_CTE_REF: 19;
    OP_JOIN: 20;
    OP_DELIM_JOIN: 21;
    OP_COMPARISON_JOIN: 22;
    OP_ANY_JOIN: 23;
    OP_CROSS_PRODUCT: 24;
    OP_UNION: 25;
    OP_EXCEPT: 26;
    OP_INTERSECT: 27;
    OP_RECURSIVE_CTE: 28;
    OP_INSERT: 29;
    OP_DELETE: 30;
    OP_UPDATE: 31;
    OP_ALTER: 32;
    OP_CREATE_TABLE: 33;
    OP_CREATE_INDEX: 34;
    OP_CREATE_SEQUENCE: 35;
    OP_CREATE_VIEW: 36;
    OP_CREATE_SCHEMA: 37;
    OP_DROP: 38;
    OP_PRAGMA: 39;
    OP_TRANSACTION: 40;
    OP_EXPLAIN: 41;
    OP_PREPARE: 42;
    OP_EXECUTE: 43;
    OP_VACUUM: 44;
}

export const LogicalOperatorType: LogicalOperatorTypeMap;
