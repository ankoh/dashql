/// This is derived from a Typescript implementation of the Myers diff algorithm:
/// https://github.com/gliese1337/fast-myers-diff/blob/master/src/index.ts

/// Copyright 2021 Logan R. Kearsley
/// 
/// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
/// 
/// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
/// 
/// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import { diff, applyPatch, calcPatch } from "./diff.js";

namespace testutils {
    export class CharArray extends Uint16Array {
        constructor(v: any) {
            super(typeof v === 'string' ? v.split('').map(x => x.charCodeAt(0)) : v);
            Object.defineProperties(this, { length: { writable: false, value: super.length } });
        }
        toString() {
            return String.fromCharCode(...this.codeArray());
        }
        slice(start?: number, end?: number): CharArray {
            return new CharArray(this.subarray(start, end));
        }
        array(): string[] {
            return this.toString().split('');
        }
        codeArray(): number[] {
            return Array.from(this);
        }
    }

    export function string(n: number) {
        const u = new CharArray(n);
        for (let i = 0; i < n; ++i) {
            u[i] = 65 + 20 * Math.random();
        }
        return u;
    }

    /// Produces an array with nSamples values between 0 <= v[i] < end
    export function sample(nSamples: number, end: number): Int32Array {
        const _result = new Int32Array(nSamples);
        if (2 * nSamples > end) {
            const skip = sample(end - nSamples, end);
            let skipped = 0;
            for (let i = 0; i < nSamples; ++i) {
                if (i + skipped === skip[skipped]) {
                    ++skipped;
                }
                _result[i] = i + skipped;
            }
        } else {
            for (let i = 0; i < nSamples; ++i) {
                _result[i] = ~~(Math.random() * (end - nSamples));
            }
            _result.sort();
            for (let i = 0; i < nSamples; ++i) {
                _result[i] += i;
            }
        }
        return _result;
    }

    export function substring(input: CharArray, totalLength: number): CharArray {
        const out = new CharArray(totalLength);
        const pos = sample(totalLength, input.length);
        for (let i = 0; i < totalLength; ++i) {
            out[i] = input[pos[i]];
        }
        return out;
    }


    /**
     * Starting from a sequence z produces two sequences
     * x and y by removing symbols
     * @param n: length of the initial string
     * @param d1: number of characters deleted to produce x
     * @param d2: number of characters deleted to produce y
     * @returns [number[], number[]
     */
    export function subsequences(n: number | CharArray, d1: number, d2: number): [CharArray, CharArray] {
        const z = typeof n === 'number' ? string(n) : n;
        const x = substring(z, z.length - d1);
        const y = substring(z, z.length - d2);
        return [x, y];
    }

    type DiffPredictionInfo = { x: CharArray, y: CharArray, s1: Int32Array, s2: Int32Array, diffs: number[][] }

    function direcDiffPrediction(n: number, c1: number, c2: number, margin: number, v1: number, v2: number) {
        const x = new CharArray(n + c1);
        const y = new CharArray(n + c2);
        const s1 = sample(c1, n + c1 - (c1 + c2) * margin);
        const s2 = sample(c2, n + c2 - (c1 + c2) * margin);
        let offset = 0;
        const diffs = [];
        let i1 = 0;
        let i2 = 0;
        while (i1 < c1 || i2 < c2) {
            if (i1 < c1 && (i2 >= c2 || s1[i1] - i1 <= s2[i2] - i2)) {
                const t = (s1[i1++] += offset + 1);
                diffs.push([t, t + 1, t + 1 + (i2 - i1), t + 1 + (i2 - i1)]);
                x[t] = v1;
            } else {
                const t = (s2[i2++] += offset + 1);
                diffs.push([t + 1 - (i2 - i1), t + 1 - (i2 - i1), t, t + 1]);
                y[t] = v2;
            }
            offset += margin;
        }
        return { x, y, s1, s2, diffs };
    }

    /**
     * Generates two sparse sequences with a few ones each separated by a
     * number of zeros that makes only one alignment reasonable.
     * @param n
     * @param c1
     * @param c2
     */
    export function sparseBinaryPredictable(n: number, c1: number, c2: number): DiffPredictionInfo {
        if ((c1 + c2) * (c1 + c2 + 1) > n) {
            throw new Error('The changes must be sparser');
        }
        const margin = c1 + c2 + 1;
        const v1 = 1, v2 = 1;
        return direcDiffPrediction(n, c1, c2, margin, v1, v2);
    }

    /**
     * Generates two sequences with a few values set to distinct values
     * so that there no match except for the common subsequence
     * gives a margin of 1 ensuring that x and y are not changed
     * at the same position, to prevent ambiguity on the order of
     * the operations.
     */
    export function densePredictable(n: number, c1: number, c2: number): DiffPredictionInfo {
        if ((c1 + c2) * 2 > n) {
            throw new Error('More changes than the vector length');
        }
        const v1 = 1, v2 = 2;
        return direcDiffPrediction(n, c1, c2, 1, v1, v2);
    }


    const chars = 'abcdefghijklmnopqrstuvwxyz01234567890';

    /**
     * Let E(x) = [0..n).map( i => [0..n).map(j => x[i] == y[j] ))
     *
     * Generates sequences such that for every x of length n, there is one
     * representative output r, such that E(r, r) equals E(x, r)
     *
     * If k is given then it will produce at most k distinct elements
     * If c is given then produces the representatives such that given
     * a sequence x with n elements and a sequence y with c distinct elements
     * one of the outputs r will have E([0..c), r) = E(uniq(y), x)
     * where uniq remove repeated elements from y.
     *
     */
    export function* equivalencyClasses(n: number, c = 0, k = Infinity):
        Generator<[number, string[]]> {
        const seq: number[] = [];
        function* work(i: number, j: number): Generator<[number, string[]]> {
            if (i == n) {
                yield [j, seq.map(i => chars[i])];
            } else {
                for (seq[i] = 0; seq[i] < j; ++seq[i]) {
                    yield* work(i + 1, j);
                }
                if (j < k) {
                    yield* work(i + 1, j + 1);
                }
            }
        }
        yield* work(0, Math.min(c, k));
    }


    export function checkDiffComputation(xs: CharArray, ys: CharArray, B: number): number[][] {
        const [xsw, ysw] = accessWatchDog(B, [xs.array(), ys.array()]);
        let es = [];
        try {
            es = [...diff(xsw, ysw)];
        } catch {
            throw new Error(JSON.stringify({ message: 'Too many operations', x: [...xs], y: [...ys] }, null, 2));
        }
        const edited = edit(xs.array(), ys.array(), es).join('');
        expect(edited).toEqual(ys.toString());
        return es;
    }

    export function diffSize(diffs: number[][]): number {
        let s = 0;
        for (const [xs, xe, ys, ye] of diffs) {
            s += (xe - xs) + (ye - ys);
        }
        return s;
    }

    export function* allPairsCore(n1: number, n2: number): Generator<[string[], string[]]> {
        for (const [c, v1] of equivalencyClasses(n1)) {
            for (const [, v2] of equivalencyClasses(n2, c, c + 1)) {
                yield [v1, v2];
            }
        }
    }

    export function* allPairs(n1: number, n2: number): Generator<[string[], string[]]> {
        // promote less redundancy
        if (n1 > n2) {
            for (const [v2, v1] of allPairsCore(n2, n1)) {
                yield [v1, v2];
            }
        } else {
            yield* allPairsCore(n1, n2);
        }
    }

    export function accessWatchDog<T extends object>(max: number, arrays: T[]): T[] {
        let counter = 0;
        const handler = {
            get: function(target: object, prop: PropertyKey, receiver: any): any {
                if (/^\d+$/.test(prop.toString())) {
                    if (++counter >= max) {
                        throw new Error('Too many operations');
                    }
                }
                return Reflect.get(target, prop, receiver);
            }
        };
        return arrays.map(x => {
            return new Proxy<T>(x, handler);
        });
    }


    export function edit<T>(xs: T[], ys: T[], es: Iterable<[number, number, number, number]>) {
        let i = 0;
        const result: T[] = [];
        for (const [sx, ex, sy, ey] of es) {
            while (i < sx) result.push(xs[i++]);
            if (sx < ex) {
                i = ex; // delete
            }
            if (sy < ey) {
                result.push(...ys.slice(sy, ey)); // insert
            }
        }
        result.push(...xs.slice(i));
        return result;
    }

    /**
     * Compute the portion of xs and ys that is not marked as different
     * in an actual diff the two returned arrays must be the LCS.
     * @param xs
     * @param ys
     * @param es
     */
    export function excludeDiff<T>(xs: T[], ys: T[], es: Iterable<number[]>): [T[], T[]] {
        let ix = 0;
        let iy = 0;
        const rx: T[] = [];
        const ry: T[] = [];
        for (const [sx, ex, sy, ey] of es) {
            while (ix < sx) rx.push(xs[ix++]);
            while (iy < sy) ry.push(ys[iy++]);
            [ix, iy] = [ex, ey];
        }
        for (const c of xs.slice(ix)) rx.push(c);
        for (const c of ys.slice(iy)) ry.push(c);
        return [rx, ry];
    }

}


describe("Exhaustive patch tests", () => {
    for (let N = 1; N < 5; ++N) {
        for (let M = 0; M < 5; ++M) {
            describe(`all sequences of sizes N=${N}, M=${M}`, () => {
                // It can be made tight
                const complexityBound = (N + M + 1) * (N + M + 1) * 1000;
                for (const [xs, ys] of testutils.allPairs(N, M)) {
                    const [xsw, ysw] = testutils.accessWatchDog(complexityBound, [xs, ys]);
                    it(`patch '${xs.join('')}' -> '${ys.join('')}'`, () => {
                        const es = diff(xsw, ysw);
                        const edited = testutils.edit(xs, ys, es).join('');
                        expect(edited).toEqual(ys.join(''));
                        const patched = [...applyPatch(xs, calcPatch(xs, ys))].map(x => x.join('')).join('');
                        expect(patched).toEqual(ys.join(''));
                    });
                }
            });
        }
    }
});



describe("Randomized edits in small strings", () => {
    for (let n = 15; n < 25; ++n) {
        for (let d1 = 0; d1 < 10; ++d1) {
            for (let d2 = 0; d2 < 10; ++d2) {
                // It can be made tight
                const complexityBound = 2 * (2 * n + d1 + d2) * (d1 + d2 + 1);
                const [xs, ys] = testutils.subsequences(n, d1, d2);
                const [xst, yst] = [xs.toString(), ys.toString()];
                const [xsw, ysw] = testutils.accessWatchDog(complexityBound, [xs.array(), ys.array()]);
                it(`patch (${n}, ${d1}, ${d2}) '${xst}' -> '${yst}'`, () => {
                    // this will throw an error if the number of accesses exceeds
                    // the complexity bound
                    expect(xs.length).toEqual(n - d1);
                    expect(ys.length).toEqual(n - d2);
                    let es: number[][] = [];
                    try {
                        es = [...diff(xsw, ysw)];
                        expect(testutils.diffSize(es)).toBeLessThan(d1 + d2 + 1);
                    } catch (e: any) {
                        if (e.message.indexOf('Too many operations')) {
                            fail({ xst, yst }.toString() + '\nToo many operations')
                        } else {
                            throw e;
                        }
                    }
                    const edited = testutils.edit(xs.array(), ys.array(), es as any).join('');
                    expect(edited).toEqual(ys.toString());
                });
            }
        }
    }
});


describe('Diff pieces', () => {
    describe('sparse inputs with predictable results', () => {
        for (let c1 = 2; c1 <= 100; c1 += 5) {
            for (let c2 = 2; c2 <= 100; c2 += 5) {
                for (let n = (c1 + c2 + 1) * (c1 + c2 + 1); n <= 1000; n += 100) {
                    it(JSON.stringify({ c1, c2, n }), () => {
                        const { x, y, s1, s2, diffs } = testutils.sparseBinaryPredictable(n, c1, c2);
                        let seen: number[][] = [];
                        try {
                            seen = testutils.checkDiffComputation(x, y, 400 * n * (c1 + c2));
                        } catch (e: any) {
                            if (e.message.indexOf('Too many operations')) {
                                throw new Error(JSON.stringify({ n, s1: [...s1], s2: [...s2] }));
                            } else {
                                throw e;
                            }
                        }
                        expect(seen).toEqual(diffs);
                    });
                }
            }
        }
    });
    describe('dense inputs with predictable results', () => {
        for (let c1 = 1; c1 <= 10; c1 += 1) {
            for (let c2 = 1; c2 <= 10; c2 += 1) {
                for (let n = 2 * (c1 + c2 + 1); n <= 30; n += 1) {
                    it(JSON.stringify({ c1, c2, n }), () => {
                        const { x, y, s1, s2, diffs } = testutils.densePredictable(n, c1, c2);
                        let seen: number[][] = [];
                        try {
                            seen = testutils.checkDiffComputation(x, y, 4 * n * (c1 + c2));
                        } catch (e: any) {
                            if (e.message.indexOf('Too many operations')) {
                                throw new Error(JSON.stringify({ n, s1: [...s1], s2: [...s2] }));
                            } else {
                                throw e;
                            }
                        }
                        expect(seen).toEqual(diffs);

                    });
                }
            }
        }
    });
});

describe("Search good examples", () => {

    for (let d1 = 5; d1 <= 6; d1 += 3) {
        for (let d2 = 5; d2 <= 6; d2 += 3) {
            for (let n = 200; n < 2100; n += 100) {
                // It can be made tight
                const complexityBound = 100 * n * (d1 + d2 + 1);
                it(`patch (${n}, ${d1}, ${d2}) `, () => {
                    for (let k = 0; k * n < 1000; ++k) {
                        const [xs, ys] = testutils.subsequences(n, d1, d2);
                        testutils.checkDiffComputation(xs, ys, complexityBound);
                    }
                });
            }
        }
    }
});

describe("Randomized edits in big string", () => {
    const N = 5000;
    for (let d1 = 0; d1 < 50; d1 += 10) {
        for (let d2 = 0; d2 < 50; d2 += 10) {
            // It can be made tight
            const complexityBound = 40 * N * (d1 + d2 + 1);
            it(`patch (${N}, ${d1}, ${d2})`, () => {
                const [xs, ys] = testutils.subsequences(N, d1, d2);
                testutils.checkDiffComputation(xs, ys, complexityBound);
            });
        }
    }
});
