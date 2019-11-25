// https://en.wikipedia.org/wiki/Z-order_curve

const TILES = 4;
const ENTRIES_PER_TILE = 8 * 8;
const BITMAP_SIZE = TILES * ENTRIES_PER_TILE;

export class ZCurveIterator {
    z: number;
    constructor(z: number) { this.z = z; }

    get top() { return ((this.z & 0b10101010) - 1 & 0b10101010) | (this.z & 0b01010101); }
    get bottom() { return ((this.z | 0b01010101) + 1 & 0b10101010) | (this.z & 0b01010101); }
    get left() { return ((this.z & 0b01010101) - 1 & 0b01010101) | (this.z & 0b10101010); }
    get right() { return ((this.z | 0b10101010) + 1 & 0b01010101) | (this.z & 0b10101010); }
}

export class ZCurveIndex {
    bitmap: Array<boolean>;

    constructor() {
        this.bitmap = new Array<boolean>(BITMAP_SIZE);
    }

    alloc(iter: ZCurveIterator, width: number, height: number) {}
}
