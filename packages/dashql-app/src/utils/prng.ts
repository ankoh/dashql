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
