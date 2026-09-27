import { findPlanOperatorInDirection } from './plan_navigation.js';
import type { PlanSceneOperator } from './plan_scene.js';

function operator(id: number, x: number, y: number): PlanSceneOperator {
    return {
        id,
        typeName: null,
        label: `operator ${id}`,
        displayLabel: `operator ${id}`,
        rect: { x, y, width: 80, height: 32 },
        ports: 0,
        statistics: {
            inputCardinalityEstimated: 0,
            inputCardinalityConsumed: 0n,
            outputCardinalityEstimated: 0,
            outputCardinalityProduced: 0n,
            hasOutputCardinalityProduced: false,
            memoryBytes: 0n,
        },
        properties: {},
    };
}

describe('findPlanOperatorInDirection', () => {
    const operators = [
        operator(0, 100, 20),
        operator(1, 40, 100),
        operator(2, 160, 100),
        operator(3, 160, 180),
    ];

    it('selects the nearest operator in the requested direction', () => {
        expect(findPlanOperatorInDirection(operators, operators[0], 'down')?.id).toEqual(1);
        expect(findPlanOperatorInDirection(operators, operators[1], 'right')?.id).toEqual(2);
        expect(findPlanOperatorInDirection(operators, operators[3], 'up')?.id).toEqual(2);
        expect(findPlanOperatorInDirection(operators, operators[2], 'left')?.id).toEqual(1);
    });

    it('does not wrap when there is no operator in that direction', () => {
        expect(findPlanOperatorInDirection(operators, operators[0], 'up')).toBeNull();
        expect(findPlanOperatorInDirection(operators, operators[3], 'down')).toBeNull();
    });

    it('enters the plan from the edge matching the arrow direction', () => {
        expect(findPlanOperatorInDirection(operators, null, 'right')?.id).toEqual(1);
        expect(findPlanOperatorInDirection(operators, null, 'left')?.id).toEqual(2);
        expect(findPlanOperatorInDirection(operators, null, 'down')?.id).toEqual(0);
        expect(findPlanOperatorInDirection(operators, null, 'up')?.id).toEqual(3);
    });
});
