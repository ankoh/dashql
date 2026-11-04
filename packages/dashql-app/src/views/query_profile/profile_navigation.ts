import type { ProfileSceneEdge, ProfileSceneOperator } from './profile_scene.js';

export type ProfileNavigationDirection = 'left' | 'right' | 'up' | 'down';

/// Find the operator in a direction of an operator.
/// The inputs of an operator are below it, or right of it if the plan grows left-to-right. The other two directions
/// step through the operators of a level (a row, or a column if the plan grows left-to-right).
export function findProfileOperatorInDirection(
    operators: readonly ProfileSceneOperator[],
    edges: readonly Pick<ProfileSceneEdge, 'childOperator' | 'parentOperator'>[],
    current: ProfileSceneOperator | null,
    direction: ProfileNavigationDirection,
    leftToRight = false,
): ProfileSceneOperator | null {
    if (operators.length === 0) return null;
    if (current == null) {
        const sign = direction === 'left' || direction === 'up' ? -1 : 1;
        const coordinate = direction === 'left' || direction === 'right' ? 'x' : 'y';
        return [...operators].sort((left, right) =>
            sign * (left.rect[coordinate] - right.rect[coordinate]) || left.id - right.id,
        )[0];
    }

    const toChild = leftToRight ? 'right' : 'down';
    const toParent = leftToRight ? 'left' : 'up';
    if (direction === toChild) {
        const child = edges.find(edge => edge.parentOperator === current.id)?.childOperator;
        return child == null ? null : operators.find(operator => operator.id === child) ?? null;
    }
    if (direction === toParent) {
        const parent = edges.find(edge => edge.childOperator === current.id)?.parentOperator;
        return parent == null ? null : operators.find(operator => operator.id === parent) ?? null;
    }

    // The operators of a level share their y, or the left edge of their column if the plan grows left-to-right
    const level = (operator: ProfileSceneOperator) => leftToRight ? operator.rect.x - operator.rect.width / 2 : operator.rect.y;
    const position = (operator: ProfileSceneOperator) => leftToRight ? operator.rect.y : operator.rect.x;
    const backwards = direction === 'left' || direction === 'up';
    const candidates = operators.flatMap(operator => {
        if (operator.id === current.id) return [];
        const delta = position(operator) - position(current);
        if (level(operator) !== level(current)) return [];
        if (backwards ? delta >= 0 : delta <= 0) return [];
        return [{ operator, distance: Math.abs(delta) }];
    });
    candidates.sort((left, right) =>
        left.distance - right.distance
        || left.operator.id - right.operator.id,
    );
    return candidates[0]?.operator ?? null;
}
