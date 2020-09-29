import { flatbuffers } from "flatbuffers";
/**
 * @enum {number}
 */
export declare enum StatusCode {
    SUCCESS = 0,
    ERROR = 1
}
/**
 * A formatted text
 *
 * @constructor
 */
export declare class FormattedText {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    /**
     * @param number i
     * @param flatbuffers.ByteBuffer bb
     * @returns FormattedText
     */
    __init(i: number, bb: flatbuffers.ByteBuffer): FormattedText;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param FormattedText= obj
     * @returns FormattedText
     */
    static getRootAsFormattedText(bb: flatbuffers.ByteBuffer, obj?: FormattedText): FormattedText;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param FormattedText= obj
     * @returns FormattedText
     */
    static getSizePrefixedRootAsFormattedText(bb: flatbuffers.ByteBuffer, obj?: FormattedText): FormattedText;
    /**
     * @param flatbuffers.Encoding= optionalEncoding
     * @returns string|Uint8Array|null
     */
    text(): string | null;
    text(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * @param flatbuffers.Builder builder
     */
    static startFormattedText(builder: flatbuffers.Builder): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset textOffset
     */
    static addText(builder: flatbuffers.Builder, textOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @returns flatbuffers.Offset
     */
    static endFormattedText(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createFormattedText(builder: flatbuffers.Builder, textOffset: flatbuffers.Offset): flatbuffers.Offset;
}
/**
 * A raw data buffer
 *
 * @constructor
 */
export declare class RawData {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    /**
     * @param number i
     * @param flatbuffers.ByteBuffer bb
     * @returns RawData
     */
    __init(i: number, bb: flatbuffers.ByteBuffer): RawData;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param RawData= obj
     * @returns RawData
     */
    static getRootAsRawData(bb: flatbuffers.ByteBuffer, obj?: RawData): RawData;
    /**
     * @param flatbuffers.ByteBuffer bb
     * @param RawData= obj
     * @returns RawData
     */
    static getSizePrefixedRootAsRawData(bb: flatbuffers.ByteBuffer, obj?: RawData): RawData;
    /**
     * @param number index
     * @returns number
     */
    data(index: number): number | null;
    /**
     * @returns number
     */
    dataLength(): number;
    /**
     * @returns Uint8Array
     */
    dataArray(): Uint8Array | null;
    /**
     * @param flatbuffers.Builder builder
     */
    static startRawData(builder: flatbuffers.Builder): void;
    /**
     * @param flatbuffers.Builder builder
     * @param flatbuffers.Offset dataOffset
     */
    static addData(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): void;
    /**
     * @param flatbuffers.Builder builder
     * @param Array.<number> data
     * @returns flatbuffers.Offset
     */
    static createDataVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    /**
     * @param flatbuffers.Builder builder
     * @param number numElems
     */
    static startDataVector(builder: flatbuffers.Builder, numElems: number): void;
    /**
     * @param flatbuffers.Builder builder
     * @returns flatbuffers.Offset
     */
    static endRawData(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createRawData(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): flatbuffers.Offset;
}
