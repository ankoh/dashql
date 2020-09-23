// package: dashql.proto.engine
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

export class QueryResultColumn extends jspb.Message {
    clearNullMaskList(): void;
    getNullMaskList(): Array<boolean>;
    setNullMaskList(value: Array<boolean>): void;
    addNullMask(value: boolean, index?: number): boolean;

    clearRowsBoolList(): void;
    getRowsBoolList(): Array<number>;
    setRowsBoolList(value: Array<number>): void;
    addRowsBool(value: number, index?: number): number;

    clearRowsI32List(): void;
    getRowsI32List(): Array<number>;
    setRowsI32List(value: Array<number>): void;
    addRowsI32(value: number, index?: number): number;

    clearRowsU32List(): void;
    getRowsU32List(): Array<number>;
    setRowsU32List(value: Array<number>): void;
    addRowsU32(value: number, index?: number): number;

    clearRowsI64List(): void;
    getRowsI64List(): Array<number>;
    setRowsI64List(value: Array<number>): void;
    addRowsI64(value: number, index?: number): number;

    clearRowsU64List(): void;
    getRowsU64List(): Array<number>;
    setRowsU64List(value: Array<number>): void;
    addRowsU64(value: number, index?: number): number;

    clearRowsF32List(): void;
    getRowsF32List(): Array<number>;
    setRowsF32List(value: Array<number>): void;
    addRowsF32(value: number, index?: number): number;

    clearRowsF64List(): void;
    getRowsF64List(): Array<number>;
    setRowsF64List(value: Array<number>): void;
    addRowsF64(value: number, index?: number): number;

    clearRowsStrList(): void;
    getRowsStrList(): Array<string>;
    setRowsStrList(value: Array<string>): void;
    addRowsStr(value: string, index?: number): string;

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
        nullMaskList: Array<boolean>;
        rowsBoolList: Array<number>;
        rowsI32List: Array<number>;
        rowsU32List: Array<number>;
        rowsI64List: Array<number>;
        rowsU64List: Array<number>;
        rowsF32List: Array<number>;
        rowsF64List: Array<number>;
        rowsStrList: Array<string>;
    };
}

export class QueryResultChunk extends jspb.Message {
    getRowOffset(): number;
    setRowOffset(value: number): void;

    getRowCount(): number;
    setRowCount(value: number): void;

    clearColumnsList(): void;
    getColumnsList(): Array<QueryResultColumn>;
    setColumnsList(value: Array<QueryResultColumn>): void;
    addColumns(value?: QueryResultColumn, index?: number): QueryResultColumn;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryResultChunk.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: QueryResultChunk,
    ): QueryResultChunk.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: QueryResultChunk,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): QueryResultChunk;
    static deserializeBinaryFromReader(
        message: QueryResultChunk,
        reader: jspb.BinaryReader,
    ): QueryResultChunk;
}

export namespace QueryResultChunk {
    export type AsObject = {
        rowOffset: number;
        rowCount: number;
        columnsList: Array<QueryResultColumn.AsObject>;
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

    clearColumnNamesList(): void;
    getColumnNamesList(): Array<string>;
    setColumnNamesList(value: Array<string>): void;
    addColumnNames(value: string, index?: number): string;

    clearColumnSqlTypesList(): void;
    getColumnSqlTypesList(): Array<SQLType>;
    setColumnSqlTypesList(value: Array<SQLType>): void;
    addColumnSqlTypes(value?: SQLType, index?: number): SQLType;

    clearDataChunksList(): void;
    getDataChunksList(): Array<QueryResultChunk>;
    setDataChunksList(value: Array<QueryResultChunk>): void;
    addDataChunks(value?: QueryResultChunk, index?: number): QueryResultChunk;

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
        columnNamesList: Array<string>;
        columnSqlTypesList: Array<SQLType.AsObject>;
        dataChunksList: Array<QueryResultChunk.AsObject>;
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
