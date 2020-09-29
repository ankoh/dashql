// package: dashql.proto.tql
// file: tql.proto

import * as jspb from 'google-protobuf';

export class Position extends jspb.Message {
    getLine(): number;
    setLine(value: number): void;

    getColumn(): number;
    setColumn(value: number): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Position.AsObject;
    static toObject(includeInstance: boolean, msg: Position): Position.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: Position,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): Position;
    static deserializeBinaryFromReader(
        message: Position,
        reader: jspb.BinaryReader,
    ): Position;
}

export namespace Position {
    export type AsObject = {
        line: number;
        column: number;
    };
}

export class Location extends jspb.Message {
    hasBegin(): boolean;
    clearBegin(): void;
    getBegin(): Position | undefined;
    setBegin(value?: Position): void;

    hasEnd(): boolean;
    clearEnd(): void;
    getEnd(): Position | undefined;
    setEnd(value?: Position): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Location.AsObject;
    static toObject(includeInstance: boolean, msg: Location): Location.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: Location,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): Location;
    static deserializeBinaryFromReader(
        message: Location,
        reader: jspb.BinaryReader,
    ): Location;
}

export namespace Location {
    export type AsObject = {
        begin?: Position.AsObject;
        end?: Position.AsObject;
    };
}

export class String extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    getString(): string;
    setString(value: string): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): String.AsObject;
    static toObject(includeInstance: boolean, msg: String): String.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: String,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): String;
    static deserializeBinaryFromReader(
        message: String,
        reader: jspb.BinaryReader,
    ): String;
}

export namespace String {
    export type AsObject = {
        location?: Location.AsObject;
        string: string;
    };
}

export class ParameterType extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    getType(): ParameterTypeTypeMap[keyof ParameterTypeTypeMap];
    setType(value: ParameterTypeTypeMap[keyof ParameterTypeTypeMap]): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ParameterType.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: ParameterType,
    ): ParameterType.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: ParameterType,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): ParameterType;
    static deserializeBinaryFromReader(
        message: ParameterType,
        reader: jspb.BinaryReader,
    ): ParameterType;
}

export namespace ParameterType {
    export type AsObject = {
        location?: Location.AsObject;
        type: ParameterTypeTypeMap[keyof ParameterTypeTypeMap];
    };
}

export class ParameterDeclaration extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    hasName(): boolean;
    clearName(): void;
    getName(): String | undefined;
    setName(value?: String): void;

    hasLabel(): boolean;
    clearLabel(): void;
    getLabel(): String | undefined;
    setLabel(value?: String): void;

    hasType(): boolean;
    clearType(): void;
    getType(): ParameterType | undefined;
    setType(value?: ParameterType): void;

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
    static toObject(
        includeInstance: boolean,
        msg: ParameterDeclaration,
    ): ParameterDeclaration.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: ParameterDeclaration,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): ParameterDeclaration;
    static deserializeBinaryFromReader(
        message: ParameterDeclaration,
        reader: jspb.BinaryReader,
    ): ParameterDeclaration;
}

export namespace ParameterDeclaration {
    export type AsObject = {
        location?: Location.AsObject;
        name?: String.AsObject;
        label?: String.AsObject;
        type?: ParameterType.AsObject;
        valueI32: number;
        valueI64: number;
        valueF64: number;
        valueStr: string;
    };

    export enum DefaultValueCase {
        DEFAULT_VALUE_NOT_SET = 0,
        VALUE_I32 = 5,
        VALUE_I64 = 6,
        VALUE_F64 = 7,
        VALUE_STR = 8,
    }
}

export class Variable extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    hasName(): boolean;
    clearName(): void;
    getName(): String | undefined;
    setName(value?: String): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Variable.AsObject;
    static toObject(includeInstance: boolean, msg: Variable): Variable.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: Variable,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): Variable;
    static deserializeBinaryFromReader(
        message: Variable,
        reader: jspb.BinaryReader,
    ): Variable;
}

export namespace Variable {
    export type AsObject = {
        location?: Location.AsObject;
        name?: String.AsObject;
    };
}

export class QueryStatement extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    hasName(): boolean;
    clearName(): void;
    getName(): String | undefined;
    setName(value?: String): void;

    hasQueryText(): boolean;
    clearQueryText(): void;
    getQueryText(): String | undefined;
    setQueryText(value?: String): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): QueryStatement.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: QueryStatement,
    ): QueryStatement.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: QueryStatement,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): QueryStatement;
    static deserializeBinaryFromReader(
        message: QueryStatement,
        reader: jspb.BinaryReader,
    ): QueryStatement;
}

export namespace QueryStatement {
    export type AsObject = {
        location?: Location.AsObject;
        name?: String.AsObject;
        queryText?: String.AsObject;
    };
}

export class HTTPMethod extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    getVerb(): HTTPVerbMap[keyof HTTPVerbMap];
    setVerb(value: HTTPVerbMap[keyof HTTPVerbMap]): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): HTTPMethod.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: HTTPMethod,
    ): HTTPMethod.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: HTTPMethod,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): HTTPMethod;
    static deserializeBinaryFromReader(
        message: HTTPMethod,
        reader: jspb.BinaryReader,
    ): HTTPMethod;
}

export namespace HTTPMethod {
    export type AsObject = {
        location?: Location.AsObject;
        verb: HTTPVerbMap[keyof HTTPVerbMap];
    };
}

export class HTTPURL extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    hasUrl(): boolean;
    clearUrl(): void;
    getUrl(): String | undefined;
    setUrl(value?: String): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): HTTPURL.AsObject;
    static toObject(includeInstance: boolean, msg: HTTPURL): HTTPURL.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: HTTPURL,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): HTTPURL;
    static deserializeBinaryFromReader(
        message: HTTPURL,
        reader: jspb.BinaryReader,
    ): HTTPURL;
}

export namespace HTTPURL {
    export type AsObject = {
        location?: Location.AsObject;
        url?: String.AsObject;
    };
}

export class HTTPAttribute extends jspb.Message {
    hasMethod(): boolean;
    clearMethod(): void;
    getMethod(): HTTPMethod | undefined;
    setMethod(value?: HTTPMethod): void;

    hasUrl(): boolean;
    clearUrl(): void;
    getUrl(): HTTPURL | undefined;
    setUrl(value?: HTTPURL): void;

    getAttributeCase(): HTTPAttribute.AttributeCase;
    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): HTTPAttribute.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: HTTPAttribute,
    ): HTTPAttribute.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: HTTPAttribute,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): HTTPAttribute;
    static deserializeBinaryFromReader(
        message: HTTPAttribute,
        reader: jspb.BinaryReader,
    ): HTTPAttribute;
}

export namespace HTTPAttribute {
    export type AsObject = {
        method?: HTTPMethod.AsObject;
        url?: HTTPURL.AsObject;
    };

    export enum AttributeCase {
        ATTRIBUTE_NOT_SET = 0,
        METHOD = 1,
        URL = 2,
    }
}

export class HTTPAttributes extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    clearAttributesList(): void;
    getAttributesList(): Array<HTTPAttribute>;
    setAttributesList(value: Array<HTTPAttribute>): void;
    addAttributes(value?: HTTPAttribute, index?: number): HTTPAttribute;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): HTTPAttributes.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: HTTPAttributes,
    ): HTTPAttributes.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: HTTPAttributes,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): HTTPAttributes;
    static deserializeBinaryFromReader(
        message: HTTPAttributes,
        reader: jspb.BinaryReader,
    ): HTTPAttributes;
}

export namespace HTTPAttributes {
    export type AsObject = {
        location?: Location.AsObject;
        attributesList: Array<HTTPAttribute.AsObject>;
    };
}

export class HTTPLoader extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    hasUrl(): boolean;
    clearUrl(): void;
    getUrl(): String | undefined;
    setUrl(value?: String): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): HTTPLoader.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: HTTPLoader,
    ): HTTPLoader.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: HTTPLoader,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): HTTPLoader;
    static deserializeBinaryFromReader(
        message: HTTPLoader,
        reader: jspb.BinaryReader,
    ): HTTPLoader;
}

export namespace HTTPLoader {
    export type AsObject = {
        location?: Location.AsObject;
        url?: String.AsObject;
    };
}

export class FileLoader extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    hasVariable(): boolean;
    clearVariable(): void;
    getVariable(): Variable | undefined;
    setVariable(value?: Variable): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): FileLoader.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: FileLoader,
    ): FileLoader.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: FileLoader,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): FileLoader;
    static deserializeBinaryFromReader(
        message: FileLoader,
        reader: jspb.BinaryReader,
    ): FileLoader;
}

export namespace FileLoader {
    export type AsObject = {
        location?: Location.AsObject;
        variable?: Variable.AsObject;
    };
}

export class LoadStatement extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    hasName(): boolean;
    clearName(): void;
    getName(): String | undefined;
    setName(value?: String): void;

    hasHttp(): boolean;
    clearHttp(): void;
    getHttp(): HTTPLoader | undefined;
    setHttp(value?: HTTPLoader): void;

    hasFile(): boolean;
    clearFile(): void;
    getFile(): FileLoader | undefined;
    setFile(value?: FileLoader): void;

    getMethodCase(): LoadStatement.MethodCase;
    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): LoadStatement.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: LoadStatement,
    ): LoadStatement.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: LoadStatement,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): LoadStatement;
    static deserializeBinaryFromReader(
        message: LoadStatement,
        reader: jspb.BinaryReader,
    ): LoadStatement;
}

export namespace LoadStatement {
    export type AsObject = {
        location?: Location.AsObject;
        name?: String.AsObject;
        http?: HTTPLoader.AsObject;
        file?: FileLoader.AsObject;
    };

    export enum MethodCase {
        METHOD_NOT_SET = 0,
        HTTP = 3,
        FILE = 4,
    }
}

export class JSONPathExtract extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): JSONPathExtract.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: JSONPathExtract,
    ): JSONPathExtract.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: JSONPathExtract,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): JSONPathExtract;
    static deserializeBinaryFromReader(
        message: JSONPathExtract,
        reader: jspb.BinaryReader,
    ): JSONPathExtract;
}

export namespace JSONPathExtract {
    export type AsObject = {
        location?: Location.AsObject;
    };
}

export class CSVExtract extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): CSVExtract.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: CSVExtract,
    ): CSVExtract.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: CSVExtract,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): CSVExtract;
    static deserializeBinaryFromReader(
        message: CSVExtract,
        reader: jspb.BinaryReader,
    ): CSVExtract;
}

export namespace CSVExtract {
    export type AsObject = {
        location?: Location.AsObject;
    };
}

export class ExtractStatement extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    hasName(): boolean;
    clearName(): void;
    getName(): String | undefined;
    setName(value?: String): void;

    hasDataName(): boolean;
    clearDataName(): void;
    getDataName(): String | undefined;
    setDataName(value?: String): void;

    hasJson(): boolean;
    clearJson(): void;
    getJson(): JSONPathExtract | undefined;
    setJson(value?: JSONPathExtract): void;

    hasCsv(): boolean;
    clearCsv(): void;
    getCsv(): CSVExtract | undefined;
    setCsv(value?: CSVExtract): void;

    getMethodCase(): ExtractStatement.MethodCase;
    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ExtractStatement.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: ExtractStatement,
    ): ExtractStatement.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: ExtractStatement,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): ExtractStatement;
    static deserializeBinaryFromReader(
        message: ExtractStatement,
        reader: jspb.BinaryReader,
    ): ExtractStatement;
}

export namespace ExtractStatement {
    export type AsObject = {
        location?: Location.AsObject;
        name?: String.AsObject;
        dataName?: String.AsObject;
        json?: JSONPathExtract.AsObject;
        csv?: CSVExtract.AsObject;
    };

    export enum MethodCase {
        METHOD_NOT_SET = 0,
        JSON = 4,
        CSV = 5,
    }
}

export class VizType extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    getType(): VizTypeTypeMap[keyof VizTypeTypeMap];
    setType(value: VizTypeTypeMap[keyof VizTypeTypeMap]): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): VizType.AsObject;
    static toObject(includeInstance: boolean, msg: VizType): VizType.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: VizType,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): VizType;
    static deserializeBinaryFromReader(
        message: VizType,
        reader: jspb.BinaryReader,
    ): VizType;
}

export namespace VizType {
    export type AsObject = {
        location?: Location.AsObject;
        type: VizTypeTypeMap[keyof VizTypeTypeMap];
    };
}

export class VizStatement extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    hasName(): boolean;
    clearName(): void;
    getName(): String | undefined;
    setName(value?: String): void;

    hasQueryName(): boolean;
    clearQueryName(): void;
    getQueryName(): String | undefined;
    setQueryName(value?: String): void;

    hasVizType(): boolean;
    clearVizType(): void;
    getVizType(): VizType | undefined;
    setVizType(value?: VizType): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): VizStatement.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: VizStatement,
    ): VizStatement.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: VizStatement,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): VizStatement;
    static deserializeBinaryFromReader(
        message: VizStatement,
        reader: jspb.BinaryReader,
    ): VizStatement;
}

export namespace VizStatement {
    export type AsObject = {
        location?: Location.AsObject;
        name?: String.AsObject;
        queryName?: String.AsObject;
        vizType?: VizType.AsObject;
    };
}

export class Statement extends jspb.Message {
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

    getStatementCase(): Statement.StatementCase;
    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Statement.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: Statement,
    ): Statement.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: Statement,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): Statement;
    static deserializeBinaryFromReader(
        message: Statement,
        reader: jspb.BinaryReader,
    ): Statement;
}

export namespace Statement {
    export type AsObject = {
        viz?: VizStatement.AsObject;
        extract?: ExtractStatement.AsObject;
        load?: LoadStatement.AsObject;
        parameter?: ParameterDeclaration.AsObject;
        query?: QueryStatement.AsObject;
    };

    export enum StatementCase {
        STATEMENT_NOT_SET = 0,
        VIZ = 1,
        EXTRACT = 2,
        LOAD = 3,
        PARAMETER = 4,
        QUERY = 5,
    }
}

export class Error extends jspb.Message {
    hasLocation(): boolean;
    clearLocation(): void;
    getLocation(): Location | undefined;
    setLocation(value?: Location): void;

    getMessage(): string;
    setMessage(value: string): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Error.AsObject;
    static toObject(includeInstance: boolean, msg: Error): Error.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: Error,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): Error;
    static deserializeBinaryFromReader(
        message: Error,
        reader: jspb.BinaryReader,
    ): Error;
}

export namespace Error {
    export type AsObject = {
        location?: Location.AsObject;
        message: string;
    };
}

export class Module extends jspb.Message {
    clearStatementsList(): void;
    getStatementsList(): Array<Statement>;
    setStatementsList(value: Array<Statement>): void;
    addStatements(value?: Statement, index?: number): Statement;

    clearErrorsList(): void;
    getErrorsList(): Array<Error>;
    setErrorsList(value: Array<Error>): void;
    addErrors(value?: Error, index?: number): Error;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Module.AsObject;
    static toObject(includeInstance: boolean, msg: Module): Module.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: Module,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): Module;
    static deserializeBinaryFromReader(
        message: Module,
        reader: jspb.BinaryReader,
    ): Module;
}

export namespace Module {
    export type AsObject = {
        statementsList: Array<Statement.AsObject>;
        errorsList: Array<Error.AsObject>;
    };
}

export interface ParameterTypeTypeMap {
    INTEGER: 0;
    FLOAT: 1;
    TEXT: 2;
    DATE: 3;
    DATETIME: 4;
    TIME: 5;
    FILE: 6;
}

export const ParameterTypeType: ParameterTypeTypeMap;

export interface HTTPVerbMap {
    GET: 0;
    PUT: 1;
    POST: 2;
}

export const HTTPVerb: HTTPVerbMap;

export interface VizTypeTypeMap {
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

export const VizTypeType: VizTypeTypeMap;
