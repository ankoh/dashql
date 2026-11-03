import * as dashql from '@ankoh/dashql-core';
import { findProfileOperatorInDirection } from './profile_navigation.js';
import type { ProfileSceneOperator } from './profile_scene.js';

function operator(id: number, x: number, y: number): ProfileSceneOperator {
    return {
        id,
        kind: dashql.buffers.profile.ProfileOperatorKind.OTHER,
        typeName: null,
        label: `operator ${id}`,
        displayLabel: `operator ${id}`,
        rect: { x, y, width: 80, height: 32 },
        ports: 0,
        estimatedRows: Number.NaN,
        fragment: 0xFFFFFFFF,
        properties: {},
    };
}

describe('findProfileOperatorInDirection', () => {
    const operators = [
        operator(0, 100, 20),
        operator(1, 40, 100),
        operator(2, 160, 100),
        operator(3, 160, 180),
    ];
    const edges = [
        { childOperator: 1, parentOperator: 0 },
        { childOperator: 2, parentOperator: 0 },
        { childOperator: 3, parentOperator: 1 },
    ];

    it('navigates left and right to the next node on the same tree level', () => {
        expect(findProfileOperatorInDirection(operators, edges, operators[1], 'right')?.id).toEqual(2);
        expect(findProfileOperatorInDirection(operators, edges, operators[2], 'left')?.id).toEqual(1);
        expect(findProfileOperatorInDirection(operators, edges, operators[0], 'right')).toBeNull();
        expect(findProfileOperatorInDirection(operators, edges, operators[3], 'left')).toBeNull();
    });

    it('navigates down to the first direct child and up to the direct parent', () => {
        expect(findProfileOperatorInDirection(operators, edges, operators[0], 'down')?.id).toEqual(1);
        expect(findProfileOperatorInDirection(operators, edges, operators[1], 'down')?.id).toEqual(3);
        expect(findProfileOperatorInDirection(operators, edges, operators[3], 'up')?.id).toEqual(1);
        expect(findProfileOperatorInDirection(operators, edges, operators[2], 'up')?.id).toEqual(0);
    });

    it('does not skip an offset child for a vertically aligned grandchild', () => {
        const tree = [
            operator(0, 100, 20),
            operator(1, 40, 100),
            operator(2, 100, 180),
        ];
        const treeEdges = [
            { childOperator: 1, parentOperator: 0 },
            { childOperator: 2, parentOperator: 1 },
        ];

        expect(findProfileOperatorInDirection(tree, treeEdges, tree[0], 'down')?.id).toEqual(1);
        expect(findProfileOperatorInDirection(tree, treeEdges, tree[2], 'up')?.id).toEqual(1);
    });

    it('does not wrap when there is no operator in that direction', () => {
        expect(findProfileOperatorInDirection(operators, edges, operators[0], 'up')).toBeNull();
        expect(findProfileOperatorInDirection(operators, edges, operators[3], 'down')).toBeNull();
    });

    it('enters the plan from the edge matching the arrow direction', () => {
        expect(findProfileOperatorInDirection(operators, edges, null, 'right')?.id).toEqual(1);
        expect(findProfileOperatorInDirection(operators, edges, null, 'left')?.id).toEqual(2);
        expect(findProfileOperatorInDirection(operators, edges, null, 'down')?.id).toEqual(0);
        expect(findProfileOperatorInDirection(operators, edges, null, 'up')?.id).toEqual(3);
    });
});
