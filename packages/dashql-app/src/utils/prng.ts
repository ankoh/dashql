// Taken from here: https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript

export interface PseudoRandomNumberGenerator {
    next(): number;
}

export class Sfc32 implements PseudoRandomNumberGenerator {
    a: number;
    b: number;
    c: number;
    d: number;

    constructor(a: number, b: number, c: number, d: number) {
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
    }

    public nextI32(): number {
        const t = (this.a + this.b | 0) + this.d | 0;
        this.d = this.d + 1 | 0;
        this.a = this.b ^ this.b >>> 9;
        this.b = this.c + (this.c << 3) | 0;
        this.c = (this.c << 21 | this.c >>> 11);
        this.c = this.c + t | 0;
        return t >>> 0;
    }

    public next(): number {
        return Math.abs(this.nextI32() / 0xFFFFFFFF);
    }
}

export class Cyrb128 {
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

    public static from(str: string): Cyrb128 {
        return (new Cyrb128()).add(str);
    }

    public clone(): Cyrb128 {
        const c = new Cyrb128();
        c.h1 = this.h1;
        c.h2 = this.h2;
        c.h3 = this.h3;
        c.h4 = this.h4;
        return c;
    }

    public add(str: string): Cyrb128 {
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
        return this;
    }
    public addN(strs: string[]) {
        for (const str of strs) {
            this.add(str);
        }
        return this;
    }

    public asSfc32(): PseudoRandomNumberGenerator {
        return new Sfc32(this.h1, this.h2, this.h3, this.h4);
    }

};

export function randomBuffer32(len: number, rng: PseudoRandomNumberGenerator) {
    const out = new Uint32Array(len);
    for (let i = 0; i < out.length; ++i) {
        out[i] = rng.next();
    }
    return out.buffer;
}
