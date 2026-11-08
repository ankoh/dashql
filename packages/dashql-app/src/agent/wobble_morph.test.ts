import { describe, expect, it } from 'vitest';

import { DASHQL_BRAND, DBCOM_BRAND, OUTLINE_POINTS, alignmentCost, morphPoints, outlineBounds, parseClosedPath, signedArea, stepSpring } from '@ankoh/dashql-ui/wobble/wobble_morph';

/// The frame of a morph without wobble and ripple
const frame = (progress: number) => ({ progress, time: 0, wobble: 0, lag: 0.35, ripple: 0 });

/// The pieces of all brands
const PIECES = [...DASHQL_BRAND.pieces, ...DBCOM_BRAND.pieces];

/// Morph a piece to a progress
function morph(index: number, progress: number): Float64Array {
    const out = new Float64Array(2 * OUTLINE_POINTS);
    morphPoints(PIECES[index], frame(progress), out, new Float64Array(2 * OUTLINE_POINTS));
    return out;
}

describe('Wobble morph', () => {
    it('splits the face into a band per shape of the Hyper logo', () => {
        expect(DASHQL_BRAND.cutouts).toHaveLength(0);
        // The top of the cylinder and the three rings below it
        expect(DBCOM_BRAND.pieces).toHaveLength(4);
        expect(DBCOM_BRAND.cutouts).toHaveLength(0);
        // The bands of the face run from top to bottom like the shapes of the logo
        const top = DBCOM_BRAND.pieces.map(piece => outlineBounds(piece.faceRest)[1]);
        expect([...top].sort((a, b) => a - b)).toEqual(top);
    });

    it('parses quadratic segments as cubics', () => {
        const [quad] = parseClosedPath('M0,0Q3,3 6,0Z');
        expect(quad).toEqual([0, 0, 2, 2, 4, 2, 6, 0]);
    });

    it('parses the closed paths of the brand mark', () => {
        const cubics = parseClosedPath('M0,0C1,0 2,0 3,0L3,3Z');
        expect(cubics).toHaveLength(3);
        expect(cubics[2].slice(6)).toEqual([0, 0]);
    });

    it('places the brand mark pieces into the viewBox', () => {
        const [upper, lower] = DASHQL_BRAND.pieces.map(piece => outlineBounds(piece.logo));
        const expectBounds = (actual: number[], expected: number[]) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 0));
        // The brand mark shrinks by 10% around the center of the viewBox
        const scaled = (bounds: number[]) => bounds.map(v => 100 + (v - 100) * 0.9);
        expectBounds(upper, scaled([91.8, 25, 200, 125]));
        expectBounds(lower, scaled([1.8, 75, 110, 175]));
        // The Hyper logo shrinks to the height of the disk and stays centered
        const hyper = DBCOM_BRAND.pieces.map(piece => outlineBounds(piece.logo));
        expect(Math.min(...hyper.map(b => b[0]))).toBeCloseTo(43, 0);
        expect(Math.max(...hyper.map(b => b[2]))).toBeCloseTo(157, 0);
        expect(Math.min(...hyper.map(b => b[1]))).toBeCloseTo(30, 0);
        expect(Math.max(...hyper.map(b => b[3]))).toBeCloseTo(170, 0);
    });

    it('resamples every outline to the same points with the same winding', () => {
        for (const piece of PIECES) {
            expect(piece.faceRest).toHaveLength(2 * OUTLINE_POINTS);
            expect(piece.logo).toHaveLength(2 * OUTLINE_POINTS);
            expect(signedArea(piece.faceRest)).toBeGreaterThan(0);
            expect(signedArea(piece.logo)).toBeGreaterThan(0);
        }
    });

    it('rotates the brand mark to the start point that moves the points the least', () => {
        for (const piece of PIECES) {
            const aligned = alignmentCost(piece.faceRest, piece.logo, 0);
            for (let offset = 1; offset < OUTLINE_POINTS; offset += 7) {
                expect(aligned).toBeLessThanOrEqual(alignmentCost(piece.faceRest, piece.logo, offset));
            }
        }
    });

    it('starts at the face and ends at the brand mark', () => {
        for (let i = 0; i < PIECES.length; ++i) {
            const start = morph(i, 0), end = morph(i, 1);
            for (let p = 0; p < start.length; ++p) {
                expect(start[p]).toBeCloseTo(PIECES[i].faceRest[p], 6);
                expect(end[p]).toBeCloseTo(PIECES[i].logo[p], 6);
            }
        }
    });

    it('does not turn an outline inside out halfway', () => {
        for (let i = 0; i < PIECES.length; ++i) {
            for (const progress of [0.25, 0.5, 0.75]) {
                const area = signedArea(morph(i, progress));
                expect(area).toBeGreaterThan(0.5 * signedArea(PIECES[i].logo));
            }
        }
    });

    it('settles a spring at its target', () => {
        const spring = { value: 0, velocity: 0 };
        let overshoot = 0;
        for (let i = 0; i < 300; ++i) {
            stepSpring(spring, 1, 70, 9, 1 / 60);
            overshoot = Math.max(overshoot, spring.value - 1);
        }
        expect(overshoot).toBeGreaterThan(0);
        expect(spring.value).toBeCloseTo(1, 3);
    });
});
