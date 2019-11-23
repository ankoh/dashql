// package: tigon.proto.duckdb
// file: duckdb.proto

import * as jspb from "google-protobuf";

export class SQLType extends jspb.Message {
  getTypeId(): SQLTypeIDMap[keyof SQLTypeIDMap];
  setTypeId(value: SQLTypeIDMap[keyof SQLTypeIDMap]): void;

  getWidth(): number;
  setWidth(value: number): void;

  getScale(): number;
  setScale(value: number): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): SQLType.AsObject;
  static toObject(includeInstance: boolean, msg: SQLType): SQLType.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: SQLType, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): SQLType;
  static deserializeBinaryFromReader(message: SQLType, reader: jspb.BinaryReader): SQLType;
}

export namespace SQLType {
  export type AsObject = {
    typeId: SQLTypeIDMap[keyof SQLTypeIDMap],
    width: number,
    scale: number,
  }
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
  getOperatorTypesList(): Array<LogicalOperatorTypeMap[keyof LogicalOperatorTypeMap]>;
  setOperatorTypesList(value: Array<LogicalOperatorTypeMap[keyof LogicalOperatorTypeMap]>): void;
  addOperatorTypes(value: LogicalOperatorTypeMap[keyof LogicalOperatorTypeMap], index?: number): LogicalOperatorTypeMap[keyof LogicalOperatorTypeMap];

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): QueryPlan.AsObject;
  static toObject(includeInstance: boolean, msg: QueryPlan): QueryPlan.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: QueryPlan, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): QueryPlan;
  static deserializeBinaryFromReader(message: QueryPlan, reader: jspb.BinaryReader): QueryPlan;
}

export namespace QueryPlan {
  export type AsObject = {
    operatorChildrenList: Array<number>,
    operatorChildOffsetsList: Array<number>,
    operatorTypesList: Array<LogicalOperatorTypeMap[keyof LogicalOperatorTypeMap]>,
  }
}

export class QueryResultColumn extends jspb.Message {
  getTypeId(): RawTypeIDMap[keyof RawTypeIDMap];
  setTypeId(value: RawTypeIDMap[keyof RawTypeIDMap]): void;

  clearNullMaskList(): void;
  getNullMaskList(): Array<boolean>;
  setNullMaskList(value: Array<boolean>): void;
  addNullMask(value: boolean, index?: number): boolean;

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
  static toObject(includeInstance: boolean, msg: QueryResultColumn): QueryResultColumn.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: QueryResultColumn, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): QueryResultColumn;
  static deserializeBinaryFromReader(message: QueryResultColumn, reader: jspb.BinaryReader): QueryResultColumn;
}

export namespace QueryResultColumn {
  export type AsObject = {
    typeId: RawTypeIDMap[keyof RawTypeIDMap],
    nullMaskList: Array<boolean>,
    rowsI32List: Array<number>,
    rowsU32List: Array<number>,
    rowsI64List: Array<number>,
    rowsU64List: Array<number>,
    rowsF32List: Array<number>,
    rowsF64List: Array<number>,
    rowsStrList: Array<string>,
  }
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
  static toObject(includeInstance: boolean, msg: QueryResultChunk): QueryResultChunk.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: QueryResultChunk, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): QueryResultChunk;
  static deserializeBinaryFromReader(message: QueryResultChunk, reader: jspb.BinaryReader): QueryResultChunk;
}

export namespace QueryResultChunk {
  export type AsObject = {
    rowOffset: number,
    rowCount: number,
    columnsList: Array<QueryResultColumn.AsObject>,
  }
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

  clearColumnRawTypesList(): void;
  getColumnRawTypesList(): Array<RawTypeIDMap[keyof RawTypeIDMap]>;
  setColumnRawTypesList(value: Array<RawTypeIDMap[keyof RawTypeIDMap]>): void;
  addColumnRawTypes(value: RawTypeIDMap[keyof RawTypeIDMap], index?: number): RawTypeIDMap[keyof RawTypeIDMap];

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
  static toObject(includeInstance: boolean, msg: QueryResult): QueryResult.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: QueryResult, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): QueryResult;
  static deserializeBinaryFromReader(message: QueryResult, reader: jspb.BinaryReader): QueryResult;
}

export namespace QueryResult {
  export type AsObject = {
    queryId: number,
    queryPlan?: QueryPlan.AsObject,
    columnCount: number,
    rowCount: number,
    columnNamesList: Array<string>,
    columnRawTypesList: Array<RawTypeIDMap[keyof RawTypeIDMap]>,
    columnSqlTypesList: Array<SQLType.AsObject>,
    dataChunksList: Array<QueryResultChunk.AsObject>,
  }
}

export interface RawTypeIDMap {
  RAW_INVALID: 0;
  RAW_BOOLEAN: 1;
  RAW_TINYINT: 2;
  RAW_SMALLINT: 3;
  RAW_INTEGER: 4;
  RAW_BIGINT: 5;
  RAW_HASH: 6;
  RAW_POINTER: 7;
  RAW_FLOAT: 8;
  RAW_DOUBLE: 9;
  RAW_VARCHAR: 10;
  RAW_VARBINARY: 11;
}

export const RawTypeID: RawTypeIDMap;

export interface SQLTypeIDMap {
  SQL_INVALID: 0;
  SQL_NULL: 1;
  SQL_BOOLEAN: 2;
  SQL_TINYINT: 3;
  SQL_SMALLINT: 4;
  SQL_INTEGER: 5;
  SQL_BIGINT: 6;
  SQL_DATE: 7;
  SQL_TIMESTAMP: 8;
  SQL_REAL: 9;
  SQL_DOUBLE: 10;
  SQL_FLOAT: 11;
  SQL_DECIMAL: 12;
  SQL_CHAR: 13;
  SQL_VARCHAR: 14;
  SQL_VARBINARY: 15;
}

export const SQLTypeID: SQLTypeIDMap;

export interface LogicalOperatorTypeMap {
  OP_INVALID: 0;
  OP_PROJECTION: 1;
  OP_FILTER: 2;
  OP_AGGREGATE_AND_GROUP_BY: 3;
  OP_WINDOW: 4;
  OP_LIMIT: 5;
  OP_ORDER_BY: 6;
  OP_TOP_N: 7;
  OP_COPY_FROM_FILE: 8;
  OP_COPY_TO_FILE: 9;
  OP_DISTINCT: 10;
  OP_INDEX_SCAN: 11;
  OP_GET: 12;
  OP_CHUNK_GET: 13;
  OP_DELIM_GET: 14;
  OP_EXPRESSION_GET: 15;
  OP_TABLE_FUNCTION: 16;
  OP_SUBQUERY: 17;
  OP_EMPTY_RESULT: 18;
  OP_JOIN: 19;
  OP_DELIM_JOIN: 20;
  OP_COMPARISON_JOIN: 21;
  OP_ANY_JOIN: 22;
  OP_CROSS_PRODUCT: 23;
  OP_UNION: 24;
  OP_EXCEPT: 25;
  OP_INTERSECT: 26;
  OP_INSERT: 27;
  OP_DELETE: 28;
  OP_UPDATE: 29;
  OP_CREATE_TABLE: 30;
  OP_CREATE_INDEX: 31;
  OP_EXPLAIN: 32;
  OP_PRUNE_COLUMNS: 33;
  OP_PREPARE: 34;
  OP_EXECUTE: 35;
}

export const LogicalOperatorType: LogicalOperatorTypeMap;

