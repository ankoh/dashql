import type { ProfileSceneEdge, ProfileSceneOperator } from './profile_scene.js';

export type ProfileNavigationDirection = 'left' | 'right' | 'up' | 'down';

export function findProfileOperatorInDirection(
    operators: readonly ProfileSceneOperator[],
    edges: readonly Pick<ProfileSceneEdge, 'childOperator' | 'parentOperator'>[],
    current: ProfileSceneOperator | null,
    direction: ProfileNavigationDirection,
): ProfileSceneOperator | null {
    if (operators.length === 0) return null;
    if (current == null) {
        const sign = direction === 'left' || direction === 'up' ? -1 : 1;
        const coordinate = direction === 'left' || direction === 'right' ? 'x' : 'y';
        return [...operators].sort((left, right) =>
            sign * (left.rect[coordinate] - right.rect[coordinate]) || left.id - right.id,
        )[0];
    }

    if (direction === 'down') {
        const child = edges.find(edge => edge.parentOperator === current.id)?.childOperator;
        return child == null ? null : operators.find(operator => operator.id === child) ?? null;
    }
    if (direction === 'up') {
        const parent = edges.find(edge => edge.childOperator === current.id)?.parentOperator;
        return parent == null ? null : operators.find(operator => operator.id === parent) ?? null;
    }

    const candidates = operators.flatMap(operator => {
        if (operator.id === current.id) return [];
        const dx = operator.rect.x - current.rect.x;
        if (operator.rect.y !== current.rect.y) return [];
        if (direction === 'left' ? dx >= 0 : dx <= 0) return [];
        return [{ operator, distance: Math.abs(dx) }];
    });
    candidates.sort((left, right) =>
        left.distance - right.distance
        || left.operator.id - right.operator.id,
    );
    return candidates[0]?.operator ?? null;
}
