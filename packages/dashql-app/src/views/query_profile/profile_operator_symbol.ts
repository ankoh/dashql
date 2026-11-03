import * as dashql from '@ankoh/dashql-core';

type ProfileOperatorKind = dashql.buffers.profile.ProfileOperatorKind;
const Kind = dashql.buffers.profile.ProfileOperatorKind;

/// The symbols of the engine-neutral operator kinds, kinds without a symbol render their type name
const OPERATOR_SYMBOLS: ReadonlyMap<ProfileOperatorKind, string> = new Map([
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
]);

export const PROFILE_OPERATOR_SYMBOL_SIZE = 18;

export function getProfileOperatorSymbol(kind: ProfileOperatorKind): string | null {
    return OPERATOR_SYMBOLS.get(kind) ?? null;
}

/// Render the symbol instead of the label? Only if the label is just the type name.
export function shouldRenderProfileOperatorSymbol(kind: ProfileOperatorKind, typeName: string | null, label: string): boolean {
    return typeName != null && label === typeName && getProfileOperatorSymbol(kind) != null;
}

export function getProfileOperatorDisplayWidth(
    kind: ProfileOperatorKind,
    typeName: string | null,
    label: string,
    layoutWidth: number,
    paddingLeft: number,
    statusWidth: number,
    statusMarginRight: number,
    paddingRight: number,
): number {
    if (!shouldRenderProfileOperatorSymbol(kind, typeName, label)) return layoutWidth;
    return paddingLeft + statusWidth + statusMarginRight + PROFILE_OPERATOR_SYMBOL_SIZE + paddingRight;
}
