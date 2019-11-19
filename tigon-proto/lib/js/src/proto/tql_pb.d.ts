// package: tigon.proto.tql
// file: tql.proto

import * as jspb from "google-protobuf";
import * as nanopb_pb from "./nanopb_pb";

export class QueryStatement extends jspb.Message {
  getQueryName(): string;
  setQueryName(value: string): void;

  getQueryText(): string;
  setQueryText(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): QueryStatement.AsObject;
  static toObject(includeInstance: boolean, msg: QueryStatement): QueryStatement.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: QueryStatement, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): QueryStatement;
  static deserializeBinaryFromReader(message: QueryStatement, reader: jspb.BinaryReader): QueryStatement;
}

export namespace QueryStatement {
  export type AsObject = {
    queryName: string,
    queryText: string,
  }
}

export class ParameterDeclaration extends jspb.Message {
  getParameterName(): string;
  setParameterName(value: string): void;

  getParameterType(): TypeMap[keyof TypeMap];
  setParameterType(value: TypeMap[keyof TypeMap]): void;

  hasValueI32(): boolean;
  clearValueI32(): void;
  getValueI32(): number;
  setValueI32(value: number): void;

  hasValueI64(): boolean;
  clearValueI64(): void;
  getValueI64(): number;
  setValueI64(value: number): void;

  hasValueF64(): boolean;
  clearValueF64(): void;
  getValueF64(): number;
  setValueF64(value: number): void;

  hasValueStr(): boolean;
  clearValueStr(): void;
  getValueStr(): string;
  setValueStr(value: string): void;

  getDefaultValueCase(): ParameterDeclaration.DefaultValueCase;
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ParameterDeclaration.AsObject;
  static toObject(includeInstance: boolean, msg: ParameterDeclaration): ParameterDeclaration.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ParameterDeclaration, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ParameterDeclaration;
  static deserializeBinaryFromReader(message: ParameterDeclaration, reader: jspb.BinaryReader): ParameterDeclaration;
}

export namespace ParameterDeclaration {
  export type AsObject = {
    parameterName: string,
    parameterType: TypeMap[keyof TypeMap],
    valueI32: number,
    valueI64: number,
    valueF64: number,
    valueStr: string,
  }

  export enum DefaultValueCase {
    DEFAULT_VALUE_NOT_SET = 0,
    VALUE_I32 = 3,
    VALUE_I64 = 4,
    VALUE_F64 = 5,
    VALUE_STR = 6,
  }
}

export class HTTPLoadMethod extends jspb.Message {
  getHttpUrl(): string;
  setHttpUrl(value: string): void;

  getHttpMethod(): HTTPMethodMap[keyof HTTPMethodMap];
  setHttpMethod(value: HTTPMethodMap[keyof HTTPMethodMap]): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): HTTPLoadMethod.AsObject;
  static toObject(includeInstance: boolean, msg: HTTPLoadMethod): HTTPLoadMethod.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: HTTPLoadMethod, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): HTTPLoadMethod;
  static deserializeBinaryFromReader(message: HTTPLoadMethod, reader: jspb.BinaryReader): HTTPLoadMethod;
}

export namespace HTTPLoadMethod {
  export type AsObject = {
    httpUrl: string,
    httpMethod: HTTPMethodMap[keyof HTTPMethodMap],
  }
}

export class FileLoadMethod extends jspb.Message {
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): FileLoadMethod.AsObject;
  static toObject(includeInstance: boolean, msg: FileLoadMethod): FileLoadMethod.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: FileLoadMethod, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): FileLoadMethod;
  static deserializeBinaryFromReader(message: FileLoadMethod, reader: jspb.BinaryReader): FileLoadMethod;
}

export namespace FileLoadMethod {
  export type AsObject = {
  }
}

export class LoadStatement extends jspb.Message {
  getDataName(): string;
  setDataName(value: string): void;

  hasHttp(): boolean;
  clearHttp(): void;
  getHttp(): HTTPLoadMethod | undefined;
  setHttp(value?: HTTPLoadMethod): void;

  hasFile(): boolean;
  clearFile(): void;
  getFile(): FileLoadMethod | undefined;
  setFile(value?: FileLoadMethod): void;

  getLoadMethodCase(): LoadStatement.LoadMethodCase;
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): LoadStatement.AsObject;
  static toObject(includeInstance: boolean, msg: LoadStatement): LoadStatement.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: LoadStatement, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): LoadStatement;
  static deserializeBinaryFromReader(message: LoadStatement, reader: jspb.BinaryReader): LoadStatement;
}

export namespace LoadStatement {
  export type AsObject = {
    dataName: string,
    http?: HTTPLoadMethod.AsObject,
    file?: FileLoadMethod.AsObject,
  }

  export enum LoadMethodCase {
    LOAD_METHOD_NOT_SET = 0,
    HTTP = 2,
    FILE = 3,
  }
}

export class JSONExtract extends jspb.Message {
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): JSONExtract.AsObject;
  static toObject(includeInstance: boolean, msg: JSONExtract): JSONExtract.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: JSONExtract, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): JSONExtract;
  static deserializeBinaryFromReader(message: JSONExtract, reader: jspb.BinaryReader): JSONExtract;
}

export namespace JSONExtract {
  export type AsObject = {
  }
}

export class CSVColumn extends jspb.Message {
  getColumnName(): string;
  setColumnName(value: string): void;

  getColumnType(): TypeMap[keyof TypeMap];
  setColumnType(value: TypeMap[keyof TypeMap]): void;

  getSourceName(): string;
  setSourceName(value: string): void;

  getSourceIndex(): number;
  setSourceIndex(value: number): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): CSVColumn.AsObject;
  static toObject(includeInstance: boolean, msg: CSVColumn): CSVColumn.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: CSVColumn, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): CSVColumn;
  static deserializeBinaryFromReader(message: CSVColumn, reader: jspb.BinaryReader): CSVColumn;
}

export namespace CSVColumn {
  export type AsObject = {
    columnName: string,
    columnType: TypeMap[keyof TypeMap],
    sourceName: string,
    sourceIndex: number,
  }
}

export class CSVExtract extends jspb.Message {
  clearColumnsList(): void;
  getColumnsList(): Array<CSVColumn>;
  setColumnsList(value: Array<CSVColumn>): void;
  addColumns(value?: CSVColumn, index?: number): CSVColumn;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): CSVExtract.AsObject;
  static toObject(includeInstance: boolean, msg: CSVExtract): CSVExtract.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: CSVExtract, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): CSVExtract;
  static deserializeBinaryFromReader(message: CSVExtract, reader: jspb.BinaryReader): CSVExtract;
}

export namespace CSVExtract {
  export type AsObject = {
    columnsList: Array<CSVColumn.AsObject>,
  }
}

export class ExtractMethod extends jspb.Message {
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ExtractMethod.AsObject;
  static toObject(includeInstance: boolean, msg: ExtractMethod): ExtractMethod.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ExtractMethod, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ExtractMethod;
  static deserializeBinaryFromReader(message: ExtractMethod, reader: jspb.BinaryReader): ExtractMethod;
}

export namespace ExtractMethod {
  export type AsObject = {
  }
}

export class ExtractStatement extends jspb.Message {
  getExtractName(): string;
  setExtractName(value: string): void;

  getDataName(): string;
  setDataName(value: string): void;

  hasJson(): boolean;
  clearJson(): void;
  getJson(): JSONExtract | undefined;
  setJson(value?: JSONExtract): void;

  hasCsv(): boolean;
  clearCsv(): void;
  getCsv(): CSVExtract | undefined;
  setCsv(value?: CSVExtract): void;

  getMethodCase(): ExtractStatement.MethodCase;
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ExtractStatement.AsObject;
  static toObject(includeInstance: boolean, msg: ExtractStatement): ExtractStatement.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ExtractStatement, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ExtractStatement;
  static deserializeBinaryFromReader(message: ExtractStatement, reader: jspb.BinaryReader): ExtractStatement;
}

export namespace ExtractStatement {
  export type AsObject = {
    extractName: string,
    dataName: string,
    json?: JSONExtract.AsObject,
    csv?: CSVExtract.AsObject,
  }

  export enum MethodCase {
    METHOD_NOT_SET = 0,
    JSON = 3,
    CSV = 4,
  }
}

export class VizColorPalette extends jspb.Message {
  getColorTarget(): string;
  setColorTarget(value: string): void;

  clearPaletteList(): void;
  getPaletteList(): Array<number>;
  setPaletteList(value: Array<number>): void;
  addPalette(value: number, index?: number): number;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): VizColorPalette.AsObject;
  static toObject(includeInstance: boolean, msg: VizColorPalette): VizColorPalette.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: VizColorPalette, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): VizColorPalette;
  static deserializeBinaryFromReader(message: VizColorPalette, reader: jspb.BinaryReader): VizColorPalette;
}

export namespace VizColorPalette {
  export type AsObject = {
    colorTarget: string,
    paletteList: Array<number>,
  }
}

export class VizLengthValue extends jspb.Message {
  getValue(): number;
  setValue(value: number): void;

  getUnit(): VizLengthUnitMap[keyof VizLengthUnitMap];
  setUnit(value: VizLengthUnitMap[keyof VizLengthUnitMap]): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): VizLengthValue.AsObject;
  static toObject(includeInstance: boolean, msg: VizLengthValue): VizLengthValue.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: VizLengthValue, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): VizLengthValue;
  static deserializeBinaryFromReader(message: VizLengthValue, reader: jspb.BinaryReader): VizLengthValue;
}

export namespace VizLengthValue {
  export type AsObject = {
    value: number,
    unit: VizLengthUnitMap[keyof VizLengthUnitMap],
  }
}

export class VizLength extends jspb.Message {
  hasSmall(): boolean;
  clearSmall(): void;
  getSmall(): VizLengthValue | undefined;
  setSmall(value?: VizLengthValue): void;

  hasMedium(): boolean;
  clearMedium(): void;
  getMedium(): VizLengthValue | undefined;
  setMedium(value?: VizLengthValue): void;

  hasLarge(): boolean;
  clearLarge(): void;
  getLarge(): VizLengthValue | undefined;
  setLarge(value?: VizLengthValue): void;

  hasExtraLarge(): boolean;
  clearExtraLarge(): void;
  getExtraLarge(): VizLengthValue | undefined;
  setExtraLarge(value?: VizLengthValue): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): VizLength.AsObject;
  static toObject(includeInstance: boolean, msg: VizLength): VizLength.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: VizLength, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): VizLength;
  static deserializeBinaryFromReader(message: VizLength, reader: jspb.BinaryReader): VizLength;
}

export namespace VizLength {
  export type AsObject = {
    small?: VizLengthValue.AsObject,
    medium?: VizLengthValue.AsObject,
    large?: VizLengthValue.AsObject,
    extraLarge?: VizLengthValue.AsObject,
  }
}

export class VizLayout extends jspb.Message {
  hasWidth(): boolean;
  clearWidth(): void;
  getWidth(): VizLength | undefined;
  setWidth(value?: VizLength): void;

  hasHeight(): boolean;
  clearHeight(): void;
  getHeight(): VizLength | undefined;
  setHeight(value?: VizLength): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): VizLayout.AsObject;
  static toObject(includeInstance: boolean, msg: VizLayout): VizLayout.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: VizLayout, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): VizLayout;
  static deserializeBinaryFromReader(message: VizLayout, reader: jspb.BinaryReader): VizLayout;
}

export namespace VizLayout {
  export type AsObject = {
    width?: VizLength.AsObject,
    height?: VizLength.AsObject,
  }
}

export class VizAxis extends jspb.Message {
  getColumn(): string;
  setColumn(value: string): void;

  getScale(): VizAxisScaleMap[keyof VizAxisScaleMap];
  setScale(value: VizAxisScaleMap[keyof VizAxisScaleMap]): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): VizAxis.AsObject;
  static toObject(includeInstance: boolean, msg: VizAxis): VizAxis.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: VizAxis, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): VizAxis;
  static deserializeBinaryFromReader(message: VizAxis, reader: jspb.BinaryReader): VizAxis;
}

export namespace VizAxis {
  export type AsObject = {
    column: string,
    scale: VizAxisScaleMap[keyof VizAxisScaleMap],
  }
}

export class VizAxes extends jspb.Message {
  hasX(): boolean;
  clearX(): void;
  getX(): VizAxis | undefined;
  setX(value?: VizAxis): void;

  hasY(): boolean;
  clearY(): void;
  getY(): VizAxis | undefined;
  setY(value?: VizAxis): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): VizAxes.AsObject;
  static toObject(includeInstance: boolean, msg: VizAxes): VizAxes.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: VizAxes, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): VizAxes;
  static deserializeBinaryFromReader(message: VizAxes, reader: jspb.BinaryReader): VizAxes;
}

export namespace VizAxes {
  export type AsObject = {
    x?: VizAxis.AsObject,
    y?: VizAxis.AsObject,
  }
}

export class VizStatement extends jspb.Message {
  getVizName(): string;
  setVizName(value: string): void;

  getVizType(): VizTypeMap[keyof VizTypeMap];
  setVizType(value: VizTypeMap[keyof VizTypeMap]): void;

  getVizTypeFlags(): number;
  setVizTypeFlags(value: number): void;

  getQueryName(): string;
  setQueryName(value: string): void;

  hasLayout(): boolean;
  clearLayout(): void;
  getLayout(): VizLayout | undefined;
  setLayout(value?: VizLayout): void;

  getColor(): number;
  setColor(value: number): void;

  hasAxes(): boolean;
  clearAxes(): void;
  getAxes(): VizAxes | undefined;
  setAxes(value?: VizAxes): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): VizStatement.AsObject;
  static toObject(includeInstance: boolean, msg: VizStatement): VizStatement.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: VizStatement, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): VizStatement;
  static deserializeBinaryFromReader(message: VizStatement, reader: jspb.BinaryReader): VizStatement;
}

export namespace VizStatement {
  export type AsObject = {
    vizName: string,
    vizType: VizTypeMap[keyof VizTypeMap],
    vizTypeFlags: number,
    queryName: string,
    layout?: VizLayout.AsObject,
    color: number,
    axes?: VizAxes.AsObject,
  }
}

export class StatementUnion extends jspb.Message {
  hasViz(): boolean;
  clearViz(): void;
  getViz(): VizStatement | undefined;
  setViz(value?: VizStatement): void;

  hasExtract(): boolean;
  clearExtract(): void;
  getExtract(): ExtractStatement | undefined;
  setExtract(value?: ExtractStatement): void;

  hasLoad(): boolean;
  clearLoad(): void;
  getLoad(): LoadStatement | undefined;
  setLoad(value?: LoadStatement): void;

  hasParameter(): boolean;
  clearParameter(): void;
  getParameter(): ParameterDeclaration | undefined;
  setParameter(value?: ParameterDeclaration): void;

  hasQuery(): boolean;
  clearQuery(): void;
  getQuery(): QueryStatement | undefined;
  setQuery(value?: QueryStatement): void;

  getStatementCase(): StatementUnion.StatementCase;
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): StatementUnion.AsObject;
  static toObject(includeInstance: boolean, msg: StatementUnion): StatementUnion.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: StatementUnion, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): StatementUnion;
  static deserializeBinaryFromReader(message: StatementUnion, reader: jspb.BinaryReader): StatementUnion;
}

export namespace StatementUnion {
  export type AsObject = {
    viz?: VizStatement.AsObject,
    extract?: ExtractStatement.AsObject,
    load?: LoadStatement.AsObject,
    parameter?: ParameterDeclaration.AsObject,
    query?: QueryStatement.AsObject,
  }

  export enum StatementCase {
    STATEMENT_NOT_SET = 0,
    VIZ = 1,
    EXTRACT = 2,
    LOAD = 3,
    PARAMETER = 4,
    QUERY = 5,
  }
}

export class Module extends jspb.Message {
  clearStatementsList(): void;
  getStatementsList(): Array<StatementUnion>;
  setStatementsList(value: Array<StatementUnion>): void;
  addStatements(value?: StatementUnion, index?: number): StatementUnion;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): Module.AsObject;
  static toObject(includeInstance: boolean, msg: Module): Module.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: Module, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): Module;
  static deserializeBinaryFromReader(message: Module, reader: jspb.BinaryReader): Module;
}

export namespace Module {
  export type AsObject = {
    statementsList: Array<StatementUnion.AsObject>,
  }
}

export interface TypeMap {
  INTEGER: 0;
  FLOAT: 1;
  TEXT: 2;
  DATE: 3;
  DATETIME: 4;
  TIME: 5;
}

export const Type: TypeMap;

export interface HTTPMethodMap {
  GET: 0;
  PUT: 1;
  POST: 2;
}

export const HTTPMethod: HTTPMethodMap;

export interface VizTypeMap {
  VIZ_AREA: 0;
  VIZ_BAR: 1;
  VIZ_BOX: 2;
  VIZ_BUBBLE: 3;
  VIZ_GRID: 4;
  VIZ_HISTOGRAM: 5;
  VIZ_LINE: 6;
  VIZ_NUMBER: 7;
  VIZ_PIE: 8;
  VIZ_POINT: 9;
  VIZ_SCATTER: 10;
  VIZ_TABLE: 11;
  VIZ_TEXT: 12;
}

export const VizType: VizTypeMap;

export interface VizLengthUnitMap {
  SPAN: 0;
  PIXEL: 1;
  PERCENT: 2;
}

export const VizLengthUnit: VizLengthUnitMap;

export interface VizAxisScaleMap {
  LINEAR: 0;
  LOGARITHMIC: 1;
}

export const VizAxisScale: VizAxisScaleMap;

