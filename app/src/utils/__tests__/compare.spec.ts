import * as utils from '../compare';

describe('isSubset', () => {
    it('simple', () => {
        expect(utils.isSubset(1, 1)).toEqual(true);
        expect(utils.isSubset(1, 2)).toEqual(false);
        expect(utils.isSubset({ a: 1 }, { a: 1 })).toEqual(true);
        expect(utils.isSubset({ a: 1 }, { a: 2 })).toEqual(false);
        expect(utils.isSubset({ a: 1, b: 1 }, { b: 1, a: 1 })).toEqual(true);
        expect(utils.isSubset({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual(true);
        expect(utils.isSubset({ a: 1 }, { b: 2, a: 1 })).toEqual(true);
        expect(
            utils.isSubset(
                {
                    objectId: 1,
                    dataSource: { dataResolver: 0, targetQualified: 'main.foo' },
                },
                {
                    objectId: 1,
                    timeCreated: '2021-08-26T09:55:25.835Z',
                    timeUpdated: '2021-08-26T09:55:25.846Z',
                    nameQualified: '',
                    cardType: 1,
                    cardRenderer: 4,
                    statementID: 1,
                    position: { row: 0, column: 0, width: 0, height: 0 },
                    title: null,
                    inputExtra: null,
                    vegaLiteSpec: null,
                    vegaSpec: null,
                    dataSource: {
                        dataResolver: 0,
                        targetQualified: 'main.foo',
                        filters: null,
                        aggregates: null,
                        orderBy: null,
                        m5Config: null,
                        sampleSize: 0,
                    },
                },
            ),
        ).toEqual(true);
    });
});
