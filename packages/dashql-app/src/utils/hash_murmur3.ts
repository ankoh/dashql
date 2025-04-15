import { Hasher } from "./hash.js";
import { PseudoRandomNumberGenerator, Sfc32 } from "./prng.js";

// Derived from here:
// https://github.com/bryc/code/tree/master/jshash/hashes
// https://github.com/aappleby/smhasher/blob/master/src/MurmurHash3.cpp

function fmix32(h: number) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h;
}

const c1 = 0x239b961b;
const c2 = 0xab0e9789;
const c3 = 0x38b34ae5;
const c4 = 0xa1e38b93;

const encoder = new TextEncoder();

/// Implements the murmur3 x86 128 bit variant
export class Murmur3_x86_128 implements Hasher {
    h1: number;
    h2: number;
    h3: number;
    h4: number;
    len: number;

    constructor(seed: number = 0) {
        // XXX bryc xor'ed h1-h4 with p1-p4, but this is deviating from the original murmur3:
        //     https://github.com/aappleby/smhasher/blob/master/src/MurmurHash3.cpp
        this.h1 = seed;
        this.h2 = seed;
        this.h3 = seed;
        this.h4 = seed;
        this.len = 0;
    }

    public static withSeed(seed: number): Murmur3_x86_128 {
        return new Murmur3_x86_128(seed);
    }
    public static hash(str: string): Hasher {
        return (new Murmur3_x86_128()).add(str);
    }

    public clone(): Hasher {
        const c = new Murmur3_x86_128();
        c.h1 = this.h1;
        c.h2 = this.h2;
        c.h3 = this.h3;
        c.h4 = this.h4;
        c.len = this.len;
        return c;
    }

    add(keyStr: string): Hasher {
        // Get utf8 bytes for string
        const key = encoder.encode(keyStr);

        // First process blocks of 4 32-bit integers
        const bytesPerBlock = 4 * 4;
        const blockCount = Math.floor(key.length / bytesPerBlock);
        const blocks = new Uint32Array(key.buffer, key.byteOffset, blockCount * 4);

        for (let i = 0; (i + 4) <= blocks.length; i += 4) {
            let k1 = blocks[i];
            let k2 = blocks[i + 1];
            let k3 = blocks[i + 2];
            let k4 = blocks[i + 3];

            k1 = Math.imul(k1, c1); k1 = k1 << 15 | k1 >>> 17;
            this.h1 ^= Math.imul(k1, c2); this.h1 = this.h1 << 19 | this.h1 >>> 13; this.h1 += this.h2;
            this.h1 = Math.imul(this.h1, 5) + 0x561ccd1b | 0; // |0 = prevent float

            k2 = Math.imul(k2, c2); k2 = k2 << 16 | k2 >>> 16;
            this.h2 ^= Math.imul(k2, c3); this.h2 = this.h2 << 17 | this.h2 >>> 15; this.h2 += this.h3;
            this.h2 = Math.imul(this.h2, 5) + 0x0bcaa747 | 0;

            k3 = Math.imul(k3, c3); k3 = k3 << 17 | k3 >>> 15;
            this.h3 ^= Math.imul(k3, c4); this.h3 = this.h3 << 15 | this.h3 >>> 17; this.h3 += this.h4;
            this.h3 = Math.imul(this.h3, 5) + 0x96cd1c35 | 0;

            k4 = Math.imul(k4, c4); k4 = k4 << 18 | k4 >>> 14;
            this.h4 ^= Math.imul(k4, c1); this.h4 = this.h4 << 13 | this.h4 >>> 19; this.h4 += this.h1;
            this.h4 = Math.imul(this.h4, 5) + 0x32ac3b17 | 0;
        }

        // Then process the trailing bytes
        let i = blockCount * bytesPerBlock;
        let k1 = 0;
        let k2 = 0
        let k3 = 0
        let k4 = 0;
        switch (key.length & 15) {
            case 15: k4 ^= key[i + 14] << 16;
            case 14: k4 ^= key[i + 13] << 8;
            case 13: k4 ^= key[i + 12];
                k4 = Math.imul(k4, c4); k4 = k4 << 18 | k4 >>> 14;
                this.h4 ^= Math.imul(k4, c1);
            case 12: k3 ^= key[i + 11] << 24;
            case 11: k3 ^= key[i + 10] << 16;
            case 10: k3 ^= key[i + 9] << 8;
            case 9: k3 ^= key[i + 8];
                k3 = Math.imul(k3, c3); k3 = k3 << 17 | k3 >>> 15;
                this.h3 ^= Math.imul(k3, c4);
            case 8: k2 ^= key[i + 7] << 24;
            case 7: k2 ^= key[i + 6] << 16;
            case 6: k2 ^= key[i + 5] << 8;
            case 5: k2 ^= key[i + 4];
                k2 = Math.imul(k2, c2); k2 = k2 << 16 | k2 >>> 16;
                this.h2 ^= Math.imul(k2, c3);
            case 4: k1 ^= key[i + 3] << 24;
            case 3: k1 ^= key[i + 2] << 16;
            case 2: k1 ^= key[i + 1] << 8;
            case 1: k1 ^= key[i];
                k1 = Math.imul(k1, c1); k1 = k1 << 15 | k1 >>> 17;
                this.h1 ^= Math.imul(k1, c2);
        }

        this.len += key.length;
        return this;
    };

    protected finish(): [number, number, number, number] {
        let h1 = this.h1;
        let h2 = this.h2;
        let h3 = this.h3;
        let h4 = this.h4;
        h1 ^= this.len; h2 ^= this.len; h3 ^= this.len; h4 ^= this.len;
        h1 += h2; h1 += h3; h1 += h4;
        h2 += h1; h3 += h1; h4 += h1;

        h1 = fmix32(h1);
        h2 = fmix32(h2);
        h3 = fmix32(h3);
        h4 = fmix32(h4);

        h1 += h2; h1 += h3; h1 += h4;
        h2 += h1; h3 += h1; h4 += h1;

        h1 >>>= 0;
        h2 >>>= 0;
        h3 >>>= 0;
        h4 >>>= 0;

        return [h1, h2, h3, h4];
    }

    public addN(strs: string[]): Hasher {
        for (const str of strs) {
            this.add(str);
        }
        return this;
    }

    public asPrng(): PseudoRandomNumberGenerator {
        const [h1, h2, h3, h4] = this.finish();
        return new Sfc32(h1, h2, h3, h4);
    }
    public asString(): string {
        const [h1, h2, h3, h4] = this.finish();
        return (
            ("00000000" + h1.toString(16)).slice(-8) +
            ("00000000" + h2.toString(16)).slice(-8) +
            ("00000000" + h3.toString(16)).slice(-8) +
            ("00000000" + h4.toString(16)).slice(-8)
        );
    }
}
