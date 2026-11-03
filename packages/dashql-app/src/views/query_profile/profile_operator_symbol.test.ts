import * as dashql from '@ankoh/dashql-core';
import { getProfileOperatorDisplayWidth, getProfileOperatorSymbol, shouldRenderProfileOperatorSymbol } from './profile_operator_symbol.js';

const Kind = dashql.buffers.profile.ProfileOperatorKind;

describe('getProfileOperatorSymbol', () => {
    it.each([
        [Kind.OUTPUT, 'relalg_output'],
        [Kind.SCAN, 'relalg_scan'],
        [Kind.EXPLICIT_SCAN, 'relalg_explicit_scan'],
        [Kind.VIRTUAL_TABLE, 'relalg_virtual_table'],
        [Kind.TABLE_CONSTRUCTION, 'relalg_table_construction'],
        [Kind.TABLE_FUNCTION, 'relalg_table_function'],
        [Kind.FILTER, 'relalg_select'],
        [Kind.PROJECT, 'relalg_map'],
        [Kind.AGGREGATE, 'relalg_group'],
        [Kind.WINDOW, 'relalg_window'],
        [Kind.SORT, 'relalg_sort'],
        [Kind.JOIN, 'relalg_join'],
        [Kind.LEFT_OUTER_JOIN, 'relalg_left_outer_join'],
        [Kind.RIGHT_OUTER_JOIN, 'relalg_right_outer_join'],
        [Kind.LEFT_SEMI_JOIN, 'relalg_left_semi_join'],
        [Kind.RIGHT_SEMI_JOIN, 'relalg_right_semi_join'],
        [Kind.LEFT_ANTI_JOIN, 'relalg_left_anti_join'],
        [Kind.RIGHT_ANTI_JOIN, 'relalg_right_anti_join'],
        [Kind.LEFT_MARK_JOIN, 'relalg_left_mark_join'],
        [Kind.UNION_ALL, 'relalg_union_all'],
        [Kind.INTERSECT_ALL, 'relalg_intersect_all'],
        [Kind.EXCEPT_ALL, 'relalg_except_all'],
        [Kind.ITERATION, 'relalg_iteration'],
        [Kind.ITERATION_INCREMENT, 'relalg_iteration_increment'],
        [Kind.INSERT, 'relalg_insert'],
    ])('maps kind %s to %s', (kind, symbol) => {
        expect(getProfileOperatorSymbol(kind)).toEqual(symbol);
    });

    it('leaves other kinds without a symbol', () => {
        expect(getProfileOperatorSymbol(Kind.OTHER)).toBeNull();
        expect(getProfileOperatorSymbol(Kind.EXCHANGE)).toBeNull();
        expect(getProfileOperatorSymbol(Kind.FULL_OUTER_JOIN)).toBeNull();
    });
});

describe('shouldRenderProfileOperatorSymbol', () => {
    it('replaces a known type-only label', () => {
        expect(shouldRenderProfileOperatorSymbol(Kind.JOIN, 'join', 'join')).toEqual(true);
        expect(shouldRenderProfileOperatorSymbol(Kind.AGGREGATE, 'group-by', 'group-by')).toEqual(true);
    });

    it('preserves a meaningful operator label', () => {
        expect(shouldRenderProfileOperatorSymbol(Kind.SCAN, 'tablescan', 'orders')).toEqual(false);
    });

    it('preserves the text fallback for kinds without a symbol', () => {
        expect(shouldRenderProfileOperatorSymbol(Kind.OTHER, 'futureoperator', 'futureoperator')).toEqual(false);
    });
});

describe('getProfileOperatorDisplayWidth', () => {
    it('compacts a type-only symbol while retaining the status slot', () => {
        expect(getProfileOperatorDisplayWidth(Kind.JOIN, 'join', 'join', 76, 12, 14, 8, 12)).toEqual(64);
    });

    it('compacts a type-only symbol without an unused status slot', () => {
        expect(getProfileOperatorDisplayWidth(Kind.JOIN, 'join', 'join', 76, 12, 0, 0, 12)).toEqual(42);
    });

    it('preserves the layout width for labels and kinds without a symbol', () => {
        expect(getProfileOperatorDisplayWidth(Kind.SCAN, 'tablescan', 'orders', 75, 12, 0, 0, 12)).toEqual(75);
        expect(getProfileOperatorDisplayWidth(Kind.OTHER, 'futureoperator', 'futureoperator', 142, 12, 0, 0, 12)).toEqual(142);
    });
});
