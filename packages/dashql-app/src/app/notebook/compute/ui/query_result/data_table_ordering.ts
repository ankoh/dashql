import { OrderByConstraint } from '../../../../../compute/sql/sqlframe_builder.js';

export function getColumnSortDirection(field: string, ordering: OrderByConstraint[]): boolean | null {
    if (ordering.length !== 1 || ordering[0].field !== field) {
        return null;
    }
    return ordering[0].ascending ?? true;
}

export function getNextColumnSortDirection(field: string, ordering: OrderByConstraint[]): boolean | null {
    const currentDirection = getColumnSortDirection(field, ordering);
    if (currentDirection == null) {
        return true;
    }
    return currentDirection ? false : null;
}
