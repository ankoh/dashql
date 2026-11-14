/// The table of the CRC-32 of zip files (IEEE 802.3, reflected polynomial 0xEDB88320)
const TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; ++n) {
        let c = n;
        for (let k = 0; k < 8; ++k) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

/// The CRC-32 of bytes that are fed in chunks, the checksum that a zip file stores for every entry
export class Crc32 {
    private state = 0xFFFFFFFF;

    /// Add the next chunk
    update(bytes: Uint8Array): void {
        let crc = this.state;
        for (let i = 0; i < bytes.length; ++i) crc = TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        this.state = crc;
    }

    /// The checksum of the chunks so far
    get value(): number {
        return (this.state ^ 0xFFFFFFFF) >>> 0;
    }
}

/// A stream that passes its chunks through and fails at the end if their CRC-32 differs from the expected one
export function crc32CheckStream(expected: number, describe: () => string): TransformStream<Uint8Array, Uint8Array> {
    const crc = new Crc32();
    return new TransformStream({
        transform(chunk, controller) {
            crc.update(chunk);
            controller.enqueue(chunk);
        },
        flush() {
            if (crc.value !== expected >>> 0) throw new Error(`The checksum of ${describe()} differs`);
        },
    });
}
