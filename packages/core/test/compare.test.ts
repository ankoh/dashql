import * as utils from '../src/utils';

export function testCompare(): void {
    describe('isSubset', () => {
        it('simple', () => {
            expect(utils.isSubset(1, 1)).toEqual(true);
            expect(utils.isSubset(1, 2)).toEqual(false);
            expect(utils.isSubset({ a: 1 }, { a: 1 })).toEqual(true);
            expect(utils.isSubset({ a: 1 }, { a: 2 })).toEqual(false);
            expect(utils.isSubset({ a: 1, b: 1 }, { b: 1, a: 1 })).toEqual(true);
            expect(utils.isSubset({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual(true);
            expect(utils.isSubset({ a: 1 }, { b: 2, a: 1 })).toEqual(true);
        });
    });
}
