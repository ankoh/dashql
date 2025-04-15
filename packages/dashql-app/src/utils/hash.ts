// Taken from here: https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript

import { PseudoRandomNumberGenerator } from "./prng.js";

export interface Hasher {
    clone(): Hasher;
    add(str: string): Hasher;
    addN(str: string[]): Hasher;
    asPrng(): PseudoRandomNumberGenerator;
    asString(): string;
}

export function randomBuffer32(len: number, rng: PseudoRandomNumberGenerator) {
    const out = new Uint32Array(len);
    for (let i = 0; i < out.length; ++i) {
        out[i] = rng.next();
    }
    return out.buffer;
}

