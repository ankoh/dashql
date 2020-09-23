// package: dashql.proto.web_api
// file: web_api.proto

import * as jspb from 'google-protobuf';

export class FormattedText extends jspb.Message {
    getText(): string;
    setText(value: string): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): FormattedText.AsObject;
    static toObject(
        includeInstance: boolean,
        msg: FormattedText,
    ): FormattedText.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: FormattedText,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): FormattedText;
    static deserializeBinaryFromReader(
        message: FormattedText,
        reader: jspb.BinaryReader,
    ): FormattedText;
}

export namespace FormattedText {
    export type AsObject = {
        text: string;
    };
}

export class RawData extends jspb.Message {
    getData(): Uint8Array | string;
    getData_asU8(): Uint8Array;
    getData_asB64(): string;
    setData(value: Uint8Array | string): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): RawData.AsObject;
    static toObject(includeInstance: boolean, msg: RawData): RawData.AsObject;
    static extensions: { [key: number]: jspb.ExtensionFieldInfo<jspb.Message> };
    static extensionsBinary: {
        [key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>;
    };
    static serializeBinaryToWriter(
        message: RawData,
        writer: jspb.BinaryWriter,
    ): void;
    static deserializeBinary(bytes: Uint8Array): RawData;
    static deserializeBinaryFromReader(
        message: RawData,
        reader: jspb.BinaryReader,
    ): RawData;
}

export namespace RawData {
    export type AsObject = {
        data: Uint8Array | string;
    };
}

export interface StatusCodeMap {
    SUCCESS: 0;
    ERROR: 1;
}

export const StatusCode: StatusCodeMap;
