export * from "hash-wasm";

export type IDataType = string | Buffer | Uint8Array | Uint16Array | Uint32Array;

export interface IHasher {
    init: () => IHasher;
    update: (data: IDataType) => IHasher;
    digest: {
        (outputType: 'binary'): Uint8Array;
        (outputType?: 'hex'): string;
    };
    blockSize: number;
    digestSize: number;
}
