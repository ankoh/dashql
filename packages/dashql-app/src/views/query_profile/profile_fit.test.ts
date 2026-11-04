import { computeProfileFitTransform, PROFILE_FIT_PADDING, PROFILE_FIT_PADDING_BOTTOM } from './profile_fit.js';

describe('computeProfileFitTransform', () => {
    const availableHeight = 600 - PROFILE_FIT_PADDING - PROFILE_FIT_PADDING_BOTTOM;

    it('centers a plan that fits without enlarging it', () => {
        const fit = computeProfileFitTransform({ left: 0, top: 0, width: 400, height: 200 }, 800, 600);
        expect(fit.scale).toEqual(1);
        expect(fit.x).toBeCloseTo(200);
        expect(fit.y).toBeCloseTo(PROFILE_FIT_PADDING + (availableHeight - 200) / 2);
    });

    it('centers the drawn bounds of a plan that does not start at the origin', () => {
        const fit = computeProfileFitTransform({ left: -100, top: 50, width: 400, height: 200 }, 800, 600);
        expect(fit.scale).toEqual(1);
        // The center of the bounds lands in the center of the space left by the paddings
        expect(fit.x + 100 * fit.scale).toBeCloseTo(800 / 2);
        expect(fit.y + 150 * fit.scale).toBeCloseTo(PROFILE_FIT_PADDING + availableHeight / 2);
    });

    it('shrinks a wide plan to fit the width', () => {
        const fit = computeProfileFitTransform({ left: 0, top: 0, width: 1000, height: 400 }, 600, 600);
        expect(fit.scale).toBeCloseTo((600 - PROFILE_FIT_PADDING * 2) / 1000);
        expect(fit.x).toBeCloseTo(PROFILE_FIT_PADDING);
    });

    it('shrinks a tall plan to fit the height', () => {
        const fit = computeProfileFitTransform({ left: 0, top: 0, width: 600, height: 6000 }, 800, 600);
        expect(fit.scale).toBeCloseTo(availableHeight / 6000);
        expect(fit.x).toBeCloseTo((800 - 600 * fit.scale) / 2);
        expect(fit.y).toBeCloseTo(PROFILE_FIT_PADDING);
    });

    it('shrinks a large plan as far as needed to show it as a whole', () => {
        const fit = computeProfileFitTransform({ left: 20, top: 10, width: 40000, height: 20000 }, 800, 600);
        expect(fit.scale).toBeCloseTo((800 - PROFILE_FIT_PADDING * 2) / 40000);
        expect(fit.x + 20 * fit.scale).toBeCloseTo(PROFILE_FIT_PADDING);
        expect(fit.y + (10 + 20000) * fit.scale).toBeLessThanOrEqual(600 - PROFILE_FIT_PADDING_BOTTOM + 1e-9);
    });
});
