import { Hasher } from "./hash.js";
import { PseudoRandomNumberGenerator, Sfc32 } from "./prng.js";

// Derived from here:
// https://github.com/bryc/code/tree/master/jshash/hashes

function fmix32(h: number) {
    h ^= h >>> 16; h = Math.imul(h, 2246822507);
    h ^= h >>> 13; h = Math.imul(h, 3266489909);
    h ^= h >>> 16;
    return h;
}

const P1 = 597399067;
const P2 = 2869860233;
const P3 = 951274213;
const P4 = 2716044179;

const encoder = new TextEncoder();

export class Murmur3_128 implements Hasher {
    h1: number;
    h2: number;
    h3: number;
    h4: number;

    constructor() {
        this.h1 = P1;
        this.h2 = P2;
        this.h3 = P3;
        this.h4 = P4;
    }

    public static from(str: string): Hasher {
        return (new Murmur3_128()).add(str);
    }

    public clone(): Hasher {
        const c = new Murmur3_128();
        c.h1 = this.h1;
        c.h2 = this.h2;
        c.h3 = this.h3;
        c.h4 = this.h4;
        return c;
    }

    add(keyStr: string): Hasher {
        const key = encoder.encode(keyStr);

        let k1 = 0;
        let k2 = 0;
        let k3 = 0;
        let k4 = 0;
        for (var i = 0, b = key.length & -16; i < b;) {
            k1 = key[i + 3] << 24 | key[i + 2] << 16 | key[i + 1] << 8 | key[i];
            k1 = Math.imul(k1, P1); k1 = k1 << 15 | k1 >>> 17;
            this.h1 ^= Math.imul(k1, P2); this.h1 = this.h1 << 19 | this.h1 >>> 13; this.h1 += this.h2;
            this.h1 = Math.imul(this.h1, 5) + 1444728091 | 0; // |0 = prevent float
            i += 4;
            k2 = key[i + 3] << 24 | key[i + 2] << 16 | key[i + 1] << 8 | key[i];
            k2 = Math.imul(k2, P2); k2 = k2 << 16 | k2 >>> 16;
            this.h2 ^= Math.imul(k2, P3); this.h2 = this.h2 << 17 | this.h2 >>> 15; this.h2 += this.h3;
            this.h2 = Math.imul(this.h2, 5) + 197830471 | 0;
            i += 4;
            k3 = key[i + 3] << 24 | key[i + 2] << 16 | key[i + 1] << 8 | key[i];
            k3 = Math.imul(k3, P3); k3 = k3 << 17 | k3 >>> 15;
            this.h3 ^= Math.imul(k3, P4); this.h3 = this.h3 << 15 | this.h3 >>> 17; this.h3 += this.h4;
            this.h3 = Math.imul(this.h3, 5) + 2530024501 | 0;
            i += 4;
            k4 = key[i + 3] << 24 | key[i + 2] << 16 | key[i + 1] << 8 | key[i];
            k4 = Math.imul(k4, P4); k4 = k4 << 18 | k4 >>> 14;
            this.h4 ^= Math.imul(k4, P1); this.h4 = this.h4 << 13 | this.h4 >>> 19; this.h4 += this.h1;
            this.h4 = Math.imul(this.h4, 5) + 850148119 | 0;
            i += 4;
        }

        k1 = 0, k2 = 0, k3 = 0, k4 = 0;
        switch (key.length & 15) {
            case 15: k4 ^= key[i + 14] << 16;
            case 14: k4 ^= key[i + 13] << 8;
            case 13: k4 ^= key[i + 12];
                k4 = Math.imul(k4, P4); k4 = k4 << 18 | k4 >>> 14;
                this.h4 ^= Math.imul(k4, P1);
            case 12: k3 ^= key[i + 11] << 24;
            case 11: k3 ^= key[i + 10] << 16;
            case 10: k3 ^= key[i + 9] << 8;
            case 9: k3 ^= key[i + 8];
                k3 = Math.imul(k3, P3); k3 = k3 << 17 | k3 >>> 15;
                this.h3 ^= Math.imul(k3, P4);
            case 8: k2 ^= key[i + 7] << 24;
            case 7: k2 ^= key[i + 6] << 16;
            case 6: k2 ^= key[i + 5] << 8;
            case 5: k2 ^= key[i + 4];
                k2 = Math.imul(k2, P2); k2 = k2 << 16 | k2 >>> 16;
                this.h2 ^= Math.imul(k2, P3);
            case 4: k1 ^= key[i + 3] << 24;
            case 3: k1 ^= key[i + 2] << 16;
            case 2: k1 ^= key[i + 1] << 8;
            case 1: k1 ^= key[i];
                k1 = Math.imul(k1, P1); k1 = k1 << 15 | k1 >>> 17;
                this.h1 ^= Math.imul(k1, P2);
        }


        this.h1 ^= key.length; this.h2 ^= key.length; this.h3 ^= key.length; this.h4 ^= key.length;
        this.h1 += this.h2; this.h1 += this.h3; this.h1 += this.h4;
        this.h2 += this.h1; this.h3 += this.h1; this.h4 += this.h1;

        this.h1 = fmix32(this.h1);
        this.h2 = fmix32(this.h2);
        this.h3 = fmix32(this.h3);
        this.h4 = fmix32(this.h4);

        this.h1 += this.h2; this.h1 += this.h3; this.h1 += this.h4;
        this.h2 += this.h1; this.h3 += this.h1; this.h4 += this.h1;

        return this;
    };

    public addN(strs: string[]): Hasher {
        for (const str of strs) {
            this.add(str);
        }
        return this;
    }

    public asPrng(): PseudoRandomNumberGenerator {
        return new Sfc32(this.h1, this.h2, this.h3, this.h4);
    }
}
