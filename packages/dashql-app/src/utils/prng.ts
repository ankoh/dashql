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
        this.a |= 0;
        this.b |= 0;
        this.c |= 0;
        this.d |= 0;
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

export class Jsf32b implements PseudoRandomNumberGenerator {
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
        this.a |= 0; this.b |= 0; this.c |= 0; this.d |= 0;
        const t = this.a - (this.b << 23 | this.b >>> 9) | 0;
        this.a = this.b ^ (this.c << 16 | this.c >>> 16) | 0;
        this.b = this.c + (this.d << 11 | this.d >>> 21) | 0;
        this.b = this.c + this.d | 0;
        this.c = this.d + t | 0;
        this.d = this.a + t | 0;
        return t;
    }

    public next(): number {
        return Math.abs(this.nextI32() / 0xFFFFFFFF);
    }
}

export class TycheI implements PseudoRandomNumberGenerator {
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
        this.a |= 0; this.b |= 0; this.c |= 0; this.d |= 0;
        this.b = (this.b << 25 | this.b >>> 7) ^ this.c; this.c = this.c - this.d | 0;
        this.d = (this.d << 24 | this.d >>> 8) ^ this.a; this.a = this.a - this.b | 0;
        this.b = (this.b << 20 | this.b >>> 12) ^ this.c; this.c = this.c - this.d | 0;
        this.d = (this.d << 16 | this.d >>> 16) ^ this.a; this.a = this.a - this.b | 0;
        return this.a >>> 0;
    }

    public next(): number {
        return Math.abs(this.nextI32() / 0xFFFFFFFF);
    }
}
