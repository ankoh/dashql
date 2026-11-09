// @vitest-environment node

import { createShellLastCommand, getPlanResultText } from './shell_result.js';
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
});

describe('the .last command', () => {
    it('opens the last result again', async () => {
        const reopen = vi.fn(() => true);
        const command = createShellLastCommand(reopen);

        expect(command[0]).toBe('last');
        expect(await command[2]([], {})).toBeUndefined();
        expect(reopen).toHaveBeenCalledOnce();
    });

    it('says when there is no result', async () => {
        expect(await createShellLastCommand(() => false)[2]([], {})).toBe('No result to show');
    });

    it('takes no arguments', () => {
        const reopen = vi.fn(() => true);
        expect(() => createShellLastCommand(reopen)[2](['2'], {})).toThrow('usage: .last');
        expect(reopen).not.toHaveBeenCalled();
    });
});
