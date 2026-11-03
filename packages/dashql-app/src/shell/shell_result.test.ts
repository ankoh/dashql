// @vitest-environment node

import { getPlanResultText, shouldShowResultUI } from './shell_result.js';
import { tableFromArrays } from '../tests/arrow_fixtures.js';

const PLAN = '{"operator":"executiontarget","operatorId":1}';

describe('shell plan results', () => {
    it('recognizes only a 1x1 string result containing a plan candidate', () => {
        expect(getPlanResultText(tableFromArrays({ value: [PLAN] }))).toBe(PLAN);
        expect(getPlanResultText(tableFromArrays({ value: ['{"key":1}'] }))).toBeNull();
        expect(getPlanResultText(tableFromArrays({ value: ['{"operator":'] }))).toBeNull();
        expect(getPlanResultText(tableFromArrays({ value: [42] }))).toBeNull();
        expect(getPlanResultText(tableFromArrays({ value: [PLAN, PLAN] }))).toBeNull();
        expect(getPlanResultText(tableFromArrays({ value: [PLAN], extra: [1] }))).toBeNull();
    });

    it('opens plan candidates automatically while respecting explicit terminal modes', () => {
        const table = tableFromArrays({ value: [PLAN] });

        expect(shouldShowResultUI('auto', table, 1000)).toBe(true);
        expect(shouldShowResultUI('ui', table, 1000)).toBe(true);
        expect(shouldShowResultUI('term', table, 1)).toBe(false);
        expect(shouldShowResultUI('off', table, 1)).toBe(false);
    });
});
