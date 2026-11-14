import { CrossFilters, MOST_FREQUENT_FILTER, HistogramFilterPredicate, MostFrequentFilterPredicate } from './cross_filters.js';

describe('CrossFilters', () => {
    describe('constructor', () => {
        it('creates empty columnFilters', () => {
            const cf = new CrossFilters();
            expect(Object.keys(cf.columnFilters)).toHaveLength(0);
        });
    });

    describe('clone', () => {
        it('returns a distinct object', () => {
            const cf = new CrossFilters();
            expect(cf.clone()).not.toBe(cf);
        });

        it('shallow-copies columnFilters entries', () => {
            const cf = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'score', inputFieldType: {} as any, inputFieldNullable: true, statsFields: null, binFieldName: '_bin', binCount: 10 };
            cf.addHistogramFilter(1, ordinalGroup, [2, 5]);
            const cloned = cf.clone();
            expect(cloned.columnFilters[1]).toBe(cf.columnFilters[1]);
        });

        it('mutations to clone do not affect the original', () => {
            const cf = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'score', inputFieldType: {} as any, inputFieldNullable: true, statsFields: null, binFieldName: '_bin', binCount: 10 };
            cf.addHistogramFilter(1, ordinalGroup, [2, 5]);
            const cloned = cf.clone();
            cloned.addHistogramFilter(2, ordinalGroup, [0, 3]);
            expect(cf.columnFilters[2]).toBeUndefined();
        });
    });

    describe('equals', () => {
        it('returns true for two empty CrossFilters', () => {
            expect(new CrossFilters().equals(new CrossFilters())).toBe(true);
        });

        it('returns false when key counts differ', () => {
            const a = new CrossFilters();
            const b = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'x', inputFieldType: {} as any, inputFieldNullable: false, statsFields: null, binFieldName: '_bin', binCount: 10 };
            a.addHistogramFilter(1, ordinalGroup, [0, 1]);
            expect(a.equals(b)).toBe(false);
            expect(b.equals(a)).toBe(false);
        });

        it('returns false when filter types differ for the same column', () => {
            const a = new CrossFilters();
            const b = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'x', inputFieldType: {} as any, inputFieldNullable: false, statsFields: null, binFieldName: '_bin', binCount: 10 };
            a.addHistogramFilter(1, ordinalGroup, [0, 1]);
            b.columnFilters[1] = { type: MOST_FREQUENT_FILTER, value: { valueId: 1, filters: [] } };
            expect(a.equals(b)).toBe(false);
        });

        it('returns false for non-matching histogram selections', () => {
            const a = new CrossFilters();
            const b = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'x', inputFieldType: {} as any, inputFieldNullable: false, statsFields: null, binFieldName: '_bin', binCount: 10 };
            a.addHistogramFilter(1, ordinalGroup, [0, 5]);
            b.addHistogramFilter(1, ordinalGroup, [2, 5]);
            expect(a.equals(b)).toBe(false);
        });

        it('returns true for matching histogram selections', () => {
            const a = new CrossFilters();
            const b = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'x', inputFieldType: {} as any, inputFieldNullable: false, statsFields: null, binFieldName: '_bin', binCount: 10 };
            a.addHistogramFilter(1, ordinalGroup, [2, 5]);
            b.addHistogramFilter(1, ordinalGroup, [2, 5]);
            expect(a.equals(b)).toBe(true);
        });

        it('compares most-frequent filters by value id', () => {
            const stringGroup = { inputFieldName: 'category', inputFieldType: {} as any, inputFieldNullable: true, statsFields: null, valueIdFieldName: '_category_id' };
            const a = new CrossFilters();
            const b = new CrossFilters();
            a.addMostFrequentValueFilter(1, stringGroup, 2);
            b.addMostFrequentValueFilter(1, stringGroup, 2);
            expect(a.equals(b)).toBe(true);

            b.addMostFrequentValueFilter(1, stringGroup, 3);
            expect(a.equals(b)).toBe(false);
        });
    });

    describe('createFilterTransforms', () => {
        it('returns empty array when no filters are set', () => {
            const cf = new CrossFilters();
            expect(cf.createFilterTransforms()).toEqual([]);
        });

        it('returns empty array for a histogram filter without a binFieldName', () => {
            const cf = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'score', inputFieldType: {} as any, inputFieldNullable: true, statsFields: null, binFieldName: null, binCount: 10 };
            cf.addHistogramFilter(1, ordinalGroup, [1, 3]);
            expect(cf.createFilterTransforms()).toEqual([]);
        });

        it('returns two scalar filters for a histogram filter with a binFieldName', () => {
            const cf = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'score', inputFieldType: {} as any, inputFieldNullable: true, statsFields: null, binFieldName: '_score_bin', binCount: 10 };
            cf.addHistogramFilter(1, ordinalGroup, [2, 7]);
            const transforms = cf.createFilterTransforms();
            expect(transforms).toHaveLength(2);
            expect(transforms[0].fieldName).toBe('_score_bin');
            expect(transforms[0].op).toBe(">=");
            expect(transforms[0].value).toBe(2);
            expect(transforms[1].fieldName).toBe('_score_bin');
            expect(transforms[1].op).toBe("<=");
            expect(transforms[1].value).toBe(7);
        });

        it('concatenates transforms from multiple histogram filters', () => {
            const cf = new CrossFilters();
            const g1 = { inputFieldName: 'a', inputFieldType: {} as any, inputFieldNullable: true, statsFields: null, binFieldName: '_a_bin', binCount: 10 };
            const g2 = { inputFieldName: 'b', inputFieldType: {} as any, inputFieldNullable: true, statsFields: null, binFieldName: '_b_bin', binCount: 10 };
            cf.addHistogramFilter(1, g1, [0, 4]);
            cf.addHistogramFilter(2, g2, [1, 9]);
            expect(cf.createFilterTransforms()).toHaveLength(4);
        });

        it('returns an equality transform for a most-frequent filter', () => {
            const cf = new CrossFilters();
            const stringGroup = { inputFieldName: 'category', inputFieldType: {} as any, inputFieldNullable: true, statsFields: null, valueIdFieldName: '_category_id' };
            cf.addMostFrequentValueFilter(1, stringGroup, 3);
            expect(cf.createFilterTransforms()).toEqual([
                { fieldName: '_category_id', op: '=', value: 3 },
            ]);
        });

        it('combines histogram and most-frequent transforms', () => {
            const cf = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'score', inputFieldType: {} as any, inputFieldNullable: true, statsFields: null, binFieldName: '_score_bin', binCount: 10 };
            const stringGroup = { inputFieldName: 'category', inputFieldType: {} as any, inputFieldNullable: true, statsFields: null, valueIdFieldName: '_category_id' };
            cf.addHistogramFilter(1, ordinalGroup, [2, 7]);
            cf.addMostFrequentValueFilter(2, stringGroup, 3);
            expect(cf.createFilterTransforms()).toEqual([
                { fieldName: '_score_bin', op: '>=', value: 2 },
                { fieldName: '_score_bin', op: '<=', value: 7 },
                { fieldName: '_category_id', op: '=', value: 3 },
            ]);
        });
    });

    describe('containsHistogramFilter', () => {
        it('returns true when brush is null and no filter exists for the column', () => {
            const cf = new CrossFilters();
            expect(cf.containsHistogramFilter(1, null)).toBe(true);
        });

        it('returns false when brush is null but a filter exists for the column', () => {
            const cf = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'x', inputFieldType: {} as any, inputFieldNullable: false, statsFields: null, binFieldName: '_bin', binCount: 10 };
            cf.addHistogramFilter(1, ordinalGroup, [0, 5]);
            expect(cf.containsHistogramFilter(1, null)).toBe(false);
        });

        it('returns false when brush is non-null but no filter exists for the column', () => {
            const cf = new CrossFilters();
            expect(cf.containsHistogramFilter(1, [0, 5])).toBe(false);
        });

        it('returns true when a histogram filter matches the given brush', () => {
            const cf = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'x', inputFieldType: {} as any, inputFieldNullable: false, statsFields: null, binFieldName: '_bin', binCount: 10 };
            cf.addHistogramFilter(1, ordinalGroup, [2, 8]);
            expect(cf.containsHistogramFilter(1, [2, 8])).toBe(true);
        });

        it('returns false when histogram selection does not match the given brush', () => {
            const cf = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'x', inputFieldType: {} as any, inputFieldNullable: false, statsFields: null, binFieldName: '_bin', binCount: 10 };
            cf.addHistogramFilter(1, ordinalGroup, [2, 8]);
            expect(cf.containsHistogramFilter(1, [3, 8])).toBe(false);
            expect(cf.containsHistogramFilter(1, [2, 9])).toBe(false);
        });

        it('returns false for a MOST_FREQUENT_FILTER when brush is non-null', () => {
            const cf = new CrossFilters();
            cf.columnFilters[1] = { type: MOST_FREQUENT_FILTER, value: { valueId: 1, filters: [] } };
            expect(cf.containsHistogramFilter(1, [0, 5])).toBe(false);
        });
    });

    describe('addHistogramFilter', () => {
        it('removes the filter when brush is null and no filter existed', () => {
            const cf = new CrossFilters();
            cf.addHistogramFilter(1, { inputFieldName: 'x', inputFieldType: {} as any, inputFieldNullable: false, statsFields: null, binFieldName: null, binCount: 10 }, null);
            expect(cf.columnFilters[1]).toBeUndefined();
        });

        it('removes an existing filter when brush is null', () => {
            const cf = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'x', inputFieldType: {} as any, inputFieldNullable: false, statsFields: null, binFieldName: '_bin', binCount: 10 };
            cf.addHistogramFilter(1, ordinalGroup, [0, 5]);
            cf.addHistogramFilter(1, ordinalGroup, null);
            expect(cf.columnFilters[1]).toBeUndefined();
        });

        it('stores filter with empty transforms when binFieldName is null', () => {
            const cf = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'score', inputFieldType: {} as any, inputFieldNullable: true, statsFields: null, binFieldName: null, binCount: 10 };
            cf.addHistogramFilter(1, ordinalGroup, [1, 4]);
            const filter = cf.columnFilters[1];
            expect(filter).toBeDefined();
            expect((filter.value as HistogramFilterPredicate).selection).toEqual([1, 4]);
            expect((filter.value as HistogramFilterPredicate).filters).toHaveLength(0);
        });

        it('stores filter with two ScalarFilter objects when binFieldName is set', () => {
            const cf = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'score', inputFieldType: {} as any, inputFieldNullable: true, statsFields: null, binFieldName: '_score_bin', binCount: 10 };
            cf.addHistogramFilter(1, ordinalGroup, [3, 9]);
            const filter = cf.columnFilters[1];
            expect(filter).toBeDefined();
            const hf = filter.value as HistogramFilterPredicate;
            expect(hf.selection).toEqual([3, 9]);
            expect(hf.filters).toHaveLength(2);
            expect(hf.filters[0].op).toBe(">=");
            expect(hf.filters[0].value).toBe(3);
            expect(hf.filters[1].op).toBe("<=");
            expect(hf.filters[1].value).toBe(9);
        });

        it('overwrites an existing filter for the same column', () => {
            const cf = new CrossFilters();
            const ordinalGroup = { inputFieldName: 'x', inputFieldType: {} as any, inputFieldNullable: false, statsFields: null, binFieldName: '_bin', binCount: 10 };
            cf.addHistogramFilter(1, ordinalGroup, [0, 5]);
            cf.addHistogramFilter(1, ordinalGroup, [2, 8]);
            expect((cf.columnFilters[1].value as HistogramFilterPredicate).selection).toEqual([2, 8]);
        });
    });

    describe('most-frequent filters', () => {
        const stringGroup = { inputFieldName: 'category', inputFieldType: {} as any, inputFieldNullable: true, statsFields: null, valueIdFieldName: '_category_id' };

        it('recognizes the selected value id', () => {
            const cf = new CrossFilters();
            expect(cf.containsMostFrequentValueFilter(1, null)).toBe(true);
            cf.addMostFrequentValueFilter(1, stringGroup, 2);
            expect(cf.containsMostFrequentValueFilter(1, 2)).toBe(true);
            expect(cf.containsMostFrequentValueFilter(1, 3)).toBe(false);
            expect(cf.containsMostFrequentValueFilter(1, null)).toBe(false);
        });

        it('replaces and removes a selected value', () => {
            const cf = new CrossFilters();
            cf.addMostFrequentValueFilter(1, stringGroup, 2);
            cf.addMostFrequentValueFilter(1, stringGroup, 3);
            const filter = cf.columnFilters[1].value as MostFrequentFilterPredicate;
            expect(filter.valueId).toBe(3);
            expect(filter.filters).toEqual([
                { fieldName: '_category_id', op: '=', value: 3 },
            ]);

            cf.addMostFrequentValueFilter(1, stringGroup, null);
            expect(cf.columnFilters[1]).toBeUndefined();
        });

        it('does not create a predicate without an id field', () => {
            const cf = new CrossFilters();
            cf.addMostFrequentValueFilter(1, { ...stringGroup, valueIdFieldName: null }, 2);
            expect(cf.columnFilters[1]).toBeUndefined();
        });
    });
});
