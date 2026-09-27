import type { PlanSceneOperator } from './plan_scene.js';

export type PlanNavigationDirection = 'left' | 'right' | 'up' | 'down';

export function findPlanOperatorInDirection(
    operators: readonly PlanSceneOperator[],
    current: PlanSceneOperator | null,
    direction: PlanNavigationDirection,
): PlanSceneOperator | null {
    if (operators.length === 0) return null;
    if (current == null) {
        const sign = direction === 'left' || direction === 'up' ? -1 : 1;
        const coordinate = direction === 'left' || direction === 'right' ? 'x' : 'y';
        return [...operators].sort((left, right) =>
            sign * (left.rect[coordinate] - right.rect[coordinate]) || left.id - right.id,
        )[0];
    }

    const candidates = operators.flatMap(operator => {
        if (operator.id === current.id) return [];
        const dx = operator.rect.x - current.rect.x;
        const dy = operator.rect.y - current.rect.y;
        const primaryDistance = direction === 'left' ? -dx
            : direction === 'right' ? dx
                : direction === 'up' ? -dy
                    : dy;
        if (primaryDistance <= 0) return [];
        const perpendicularDistance = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
        return [{ operator, perpendicularDistance, primaryDistance }];
    });
    candidates.sort((left, right) =>
        left.perpendicularDistance - right.perpendicularDistance
        || left.primaryDistance - right.primaryDistance
        || left.operator.id - right.operator.id,
    );
    return candidates[0]?.operator ?? null;
}
