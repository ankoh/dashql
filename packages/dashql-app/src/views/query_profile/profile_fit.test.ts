import * as dashql from '@ankoh/dashql-core';
import { computeProfileFitTransform, PROFILE_FIT_MIN_SCALE, PROFILE_FIT_PADDING } from './profile_fit.js';
import type { ProfileScene, ProfileSceneOperator } from './profile_scene.js';

function operator(id: number, x: number, y: number): ProfileSceneOperator {
    return {
        id,
        kind: dashql.buffers.profile.ProfileOperatorKind.OTHER,
        typeName: null,
        label: `operator ${id}`,
        displayLabel: `operator ${id}`,
        rect: { x, y, width: 80, height: 32 },
        ports: 0,
        estimatedRows: Number.NaN,
        properties: {},
    };
}

function scene(width: number, height: number): Pick<ProfileScene, 'width' | 'height' | 'operators' | 'edges'> {
    return {
        width,
        height,
        // The root sits at the top, off-center, with a child below
        operators: [operator(0, width / 4, 20), operator(1, width / 2, 100)],
        edges: [{ id: 0, childOperator: 1, parentOperator: 0, slot: 0xFFFFFFFF, outputCardinalityEstimated: 0, path: '' }],
    };
}

describe('computeProfileFitTransform', () => {
    it('centers a plan that fits', () => {
        const fit = computeProfileFitTransform(scene(400, 200), 800, 600);
        expect(fit).toEqual({ x: 200, y: 200, scale: 1 });
    });

    it('shrinks a plan down to the minimum scale to fit', () => {
        const fit = computeProfileFitTransform(scene(1000, 400), 600, 600);
        expect(fit.scale).toBeCloseTo((600 - PROFILE_FIT_PADDING * 2) / 1000);
        expect(fit.x).toBeCloseTo(PROFILE_FIT_PADDING);
    });

    it('does not shrink below the minimum scale and places the root at the top center', () => {
        const fit = computeProfileFitTransform(scene(4000, 6000), 800, 600);
        expect(fit.scale).toEqual(PROFILE_FIT_MIN_SCALE);
        // The root is at x=1000, y=20 with height 32 -> top at y=4
        expect(fit.x + 1000 * fit.scale).toBeCloseTo(400);
        expect(fit.y + 4 * fit.scale).toBeCloseTo(PROFILE_FIT_PADDING);
    });

    it('centers the scene if only the height overflows at the minimum scale', () => {
        const fit = computeProfileFitTransform(scene(600, 6000), 800, 600);
        expect(fit.scale).toEqual(PROFILE_FIT_MIN_SCALE);
        expect(fit.x).toBeCloseTo((800 - 600 * PROFILE_FIT_MIN_SCALE) / 2);
        expect(fit.y + 4 * fit.scale).toBeCloseTo(PROFILE_FIT_PADDING);
    });
});
