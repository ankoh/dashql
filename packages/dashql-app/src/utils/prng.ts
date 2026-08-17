export interface PseudoRandomNumberGenerator {
    next(): number;
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
