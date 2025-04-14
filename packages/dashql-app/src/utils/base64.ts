const B64DFT = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export class Base64Codec {
    lookupTable: Uint8Array;

    constructor() {
        // Build a lookup query_result
        this.lookupTable = new Uint8Array(256);
        this.lookupTable.fill(0xFF);
        for (let i = 0; i < B64DFT.length; i++) {
            this.lookupTable[B64DFT.charCodeAt(i)] = i;
        }
    }

    /// Encode the ArrayBuffer
    public encode(arraybuffer: ArrayBuffer) {
        const bytes = new Uint8Array(arraybuffer);
        let base64 = "";

        let reader = 0;
        for (; (reader + 3) < bytes.length; reader += 3) {
            // Upper 6 bits of first bytes
            base64 += B64DFT[bytes[reader] >> 2];
            // Lower 2 bits of first byte and upper 4 bits of second byte
            base64 += B64DFT[((bytes[reader] & 3) << 4) | (bytes[reader + 1] >> 4)];
            // Lower 4 bits of second byte and upper 2 bits of third byte
            base64 += B64DFT[((bytes[reader + 1] & 15) << 2) | (bytes[reader + 2] >> 6)];
            // Lower 4 bits of third byte
            base64 += B64DFT[bytes[reader + 2] & 63];
        }
        // Now map the remainder
        const leftOver = bytes.length - reader;
        switch (leftOver) {
            // 2 bytes left, pack into 3 bytes with trailing zero
            case 2:
                base64 += B64DFT[bytes[reader] >> 2];
                base64 += B64DFT[((bytes[reader] & 3) << 4) | (bytes[reader + 1] >> 4)];
                base64 += B64DFT[(bytes[reader + 1] & 15) << 2];
                base64 += "=";
                break;
            // 1 bytes left, pack into 2 bytes with trailing zero
            case 1:
                base64 += B64DFT[bytes[reader] >> 2];
                base64 += B64DFT[(bytes[reader] & 3) << 4];
                base64 += "==";
                break;
            case 0:
                break;

        }
        return base64;
    };

    /// Check if the string is a valid base64 sequence
    public isValidBase64(base64: string) {
        let valid = true;
        let dataLength = base64.length;
        if (base64[base64.length - 1] === "=") {
            dataLength--;
            if (base64[base64.length - 2] === "=") {
                dataLength--;
            }
        }
        for (let i = 0; i < dataLength; ++i) {
            const c = base64.charCodeAt(i);
            valid &&= this.lookupTable[c] != 0xFF;
        }
        return valid;
    }

    /// Decode a Base64 string
    public decode(base64: string) {
        // Cut the trailing equal signs
        let bufferLength = Math.floor((base64.length / 4) * 3);
        if (base64.length >= 1 && base64[base64.length - 1] === "=") {
            bufferLength--;
            if (base64.length >= 2 && base64[base64.length - 2] === "=") {
                bufferLength--;
            }
        }

        /// Allocate the ArrayBuffer
        const arraybuffer = new ArrayBuffer(bufferLength),
            bytes = new Uint8Array(arraybuffer);

        let writer = 0;
        let reader = 0;
        for (; (reader + 4) < base64.length; reader += 4) {
            // Read all bytes, storing 6 bits of data each
            const encoded1 = this.lookupTable[base64.charCodeAt(reader)];
            const encoded2 = this.lookupTable[base64.charCodeAt(reader + 1)];
            const encoded3 = this.lookupTable[base64.charCodeAt(reader + 2)];
            const encoded4 = this.lookupTable[base64.charCodeAt(reader + 3)];

            // Reconstruct original bytes from 6 bits
            bytes[writer++] = (encoded1 << 2) | (encoded2 >> 4);
            bytes[writer++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
            bytes[writer++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
        }

        // Read the remainder
        const leftOver = base64.length - reader;
        switch (leftOver) {
            case 3: {
                const encoded1 = this.lookupTable[base64.charCodeAt(reader)];
                const encoded2 = this.lookupTable[base64.charCodeAt(reader + 1)];
                const encoded3 = this.lookupTable[base64.charCodeAt(reader + 2)];
                bytes[writer++] = (encoded1 << 2) | (encoded2 >> 4);
                bytes[writer++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
                break;
            }
            case 2: {
                const encoded1 = this.lookupTable[base64.charCodeAt(reader)];
                const encoded2 = this.lookupTable[base64.charCodeAt(reader + 1)];
                bytes[writer++] = (encoded1 << 2) | (encoded2 >> 4);
                break;
            }
            case 1: {
                // We only ever consume "full" 8 bits from the input.
                // 1 base64 character only stores 6 data bits, so we just skip
                break;
            }
        }

        return arraybuffer;
    };
};

export class Base64UrlCodec {
    lookupTable: Uint8Array;

    constructor() {
        // Build a lookup query_result
        this.lookupTable = new Uint8Array(256);
        this.lookupTable.fill(0xFF);
        for (let i = 0; i < B64URL.length; i++) {
            this.lookupTable[B64URL.charCodeAt(i)] = i;
        }
    }

    /// Encode the ArrayBuffer as Base64URL
    public encode(arraybuffer: ArrayBuffer) {
        const bytes = new Uint8Array(arraybuffer);
        let base64 = "";

        // Base64 maps 6 input bits to 1 output byte (8 bits).
        // First map 3 bytes at once (24 bits), to 32 output bits (4 bytes).
        let reader = 0;
        for (; (reader + 3) <= bytes.length; reader += 3) {
            // Upper 6 bits of first byte
            base64 += B64URL[bytes[reader] >> 2];
            // Lower 2 bits of first byte and upper 4 bits of second byte
            base64 += B64URL[((bytes[reader] & 3) << 4) | (bytes[reader + 1] >> 4)];
            // Lower 4 bits of second byte and upper 2 bits of third byte
            base64 += B64URL[((bytes[reader + 1] & 15) << 2) | (bytes[reader + 2] >> 6)];
            // Lower 4 bits of third byte
            base64 += B64URL[bytes[reader + 2] & 63];
        }
        // Now map the remainder
        const leftOver = bytes.length - reader;
        switch (leftOver) {
            // 2 bytes left, pack into 3 bytes with trailing zero
            case 2:
                base64 += B64URL[bytes[reader] >> 2];
                base64 += B64URL[((bytes[reader] & 3) << 4) | (bytes[reader + 1] >> 4)];
                base64 += B64URL[(bytes[reader + 1] & 15) << 2];
                break;
            // 1 bytes left, pack into 2 bytes with trailing zero
            case 1:
                base64 += B64URL[bytes[reader] >> 2];
                base64 += B64URL[(bytes[reader] & 3) << 4];
                break;
            case 0:
                break;

        }
        return base64;
    };

    /// Check if the string is a valid base64 sequence
    public isValidBase64(base64: string) {
        let valid = true;
        for (let i = 0; i < base64.length; ++i) {
            const c = base64.charCodeAt(i);
            valid &&= this.lookupTable[c] != 0xFF;
        }
        return valid;
    }

    /// Get the decoded size
    public getDecodedSize(base64: string) {
        let resultSize = Math.floor((base64.length / 4) * 3);
        const leftOver = (resultSize % 4);
        if (leftOver == 2) {
            resultSize += 1;
        } else if (leftOver == 3) {
            resultSize += 2;
        }
        return resultSize;
    }

    /// Decode a Base64URL string
    public decode(base64: string) {
        /// Allocate the ArrayBuffer
        const bufferSize = this.getDecodedSize(base64);
        const buffer = new ArrayBuffer(bufferSize);
        const bytes = new Uint8Array(buffer);

        let writer = 0;
        let reader = 0;
        for (; (reader + 4) < base64.length; reader += 4) {
            // Read all bytes, storing 6 bits of data each
            const encoded1 = this.lookupTable[base64.charCodeAt(reader)];
            const encoded2 = this.lookupTable[base64.charCodeAt(reader + 1)];
            const encoded3 = this.lookupTable[base64.charCodeAt(reader + 2)];
            const encoded4 = this.lookupTable[base64.charCodeAt(reader + 3)];

            // Reconstruct original bytes from 6 bits
            bytes[writer++] = (encoded1 << 2) | (encoded2 >> 4);
            bytes[writer++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
            bytes[writer++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
        }

        // Read the remainder
        const leftOver = base64.length - reader;
        switch (leftOver) {
            case 3: {
                const encoded1 = this.lookupTable[base64.charCodeAt(reader)];
                const encoded2 = this.lookupTable[base64.charCodeAt(reader + 1)];
                const encoded3 = this.lookupTable[base64.charCodeAt(reader + 2)];
                bytes[writer++] = (encoded1 << 2) | (encoded2 >> 4);
                bytes[writer++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
                break;
            }
            case 2: {
                const encoded1 = this.lookupTable[base64.charCodeAt(reader)];
                const encoded2 = this.lookupTable[base64.charCodeAt(reader + 1)];
                bytes[writer++] = (encoded1 << 2) | (encoded2 >> 4);
                break;
            }
            case 1: {
                // We only ever consume "full" 8 bits from the input.
                // 1 base64 character only stores 6 data bits, so we just skip
                break;
            }
        }

        return buffer;
    };
};

export const BASE64_CODEC = new Base64Codec();
export const BASE64URL_CODEC = new Base64UrlCodec();
