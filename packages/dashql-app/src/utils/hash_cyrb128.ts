import { Hasher } from "./hash.js";
import { PseudoRandomNumberGenerator, Sfc32 } from "./prng.js";

export class Cyrb128 implements Hasher {
    protected h1: number;
    protected h2: number;
    protected h3: number;
    protected h4: number;

    constructor() {
        this.h1 = 1779033703;
        this.h2 = 3144134277;
        this.h3 = 1013904242;
        this.h4 = 2773480762;
    }

    public static from(str: string): Hasher {
        return (new Cyrb128()).add(str);
    }

    public clone(): Hasher {
        const c = new Cyrb128();
        c.h1 = this.h1;
        c.h2 = this.h2;
        c.h3 = this.h3;
        c.h4 = this.h4;
        return c;
    }

    public add(str: string): Hasher {
        for (let i = 0, k; i < str.length; i++) {
            k = str.charCodeAt(i);
            this.h1 = this.h2 ^ Math.imul(this.h1 ^ k, 597399067);
            this.h2 = this.h3 ^ Math.imul(this.h2 ^ k, 2869860233);
            this.h3 = this.h4 ^ Math.imul(this.h3 ^ k, 951274213);
            this.h4 = this.h1 ^ Math.imul(this.h4 ^ k, 2716044179);
        }
        this.h1 = Math.imul(this.h3 ^ (this.h1 >>> 18), 597399067);
        this.h2 = Math.imul(this.h4 ^ (this.h2 >>> 22), 2869860233);
        this.h3 = Math.imul(this.h1 ^ (this.h3 >>> 17), 951274213);
        this.h4 = Math.imul(this.h2 ^ (this.h4 >>> 19), 2716044179);
        this.h1 ^= (this.h2 ^ this.h3 ^ this.h4), this.h2 ^= this.h1, this.h3 ^= this.h1, this.h4 ^= this.h1;
        this.h1 >>>= 0;
        this.h2 >>>= 0;
        this.h3 >>>= 0;
        this.h4 >>>= 0;
        return this;
    }
    public addN(strs: string[]): Hasher {
        for (const str of strs) {
            this.add(str);
        }
        return this;
    }

    public asPrng(): PseudoRandomNumberGenerator {
        return new Sfc32(this.h1, this.h2, this.h3, this.h4);
    }

};
