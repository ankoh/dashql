import * as React from 'react';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as dashql from '../../../../../core/index.js';
import { ResizeObserverMock } from '../../../../../test/view_mocks.js';
import type { PlanScene, PlanSceneOperator } from './plan_scene.js';
import { PlanView } from './plan_view.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

const operators: PlanSceneOperator[] = [
    {
        id: 0,
        typeName: null,
        label: 'Scan orders',
        displayLabel: 'Scan orders',
        rect: { x: 40, y: 40, width: 100, height: 32 },
        ports: 1,
        statistics: {
            inputCardinalityEstimated: 0,
            inputCardinalityConsumed: 0n,
            outputCardinalityEstimated: 10,
            outputCardinalityProduced: 0n,
            hasOutputCardinalityProduced: false,
            memoryBytes: 0n,
        },
        properties: { table: 'orders' },
    },
    {
        id: 1,
        typeName: null,
        label: 'Project total',
        displayLabel: 'Project total',
        rect: { x: 160, y: 40, width: 100, height: 32 },
        ports: 3,
        statistics: {
            inputCardinalityEstimated: 10,
            inputCardinalityConsumed: 0n,
            outputCardinalityEstimated: 10,
            outputCardinalityProduced: 0n,
            hasOutputCardinalityProduced: false,
            memoryBytes: 0n,
        },
        properties: { expression: 'price * quantity' },
    },
    {
        id: 2,
        typeName: null,
        label: 'Return results',
        displayLabel: 'Return results',
        rect: { x: 280, y: 40, width: 100, height: 32 },
        ports: 2,
        statistics: {
            inputCardinalityEstimated: 10,
            inputCardinalityConsumed: 0n,
            outputCardinalityEstimated: 10,
            outputCardinalityProduced: 0n,
            hasOutputCardinalityProduced: false,
            memoryBytes: 0n,
        },
        properties: {},
    },
];

const scene: PlanScene = {
    width: 0,
    height: 0,
    layoutConfig: {
        input: {
            levelHeight: 64,
            nodeHeight: 32,
            nodeMarginHorizontal: 32,
            nodePaddingLeft: 12,
            nodePaddingRight: 12,
            iconWidth: 0,
            iconMarginRight: 0,
            maxLabelChars: 20,
            widthPerLabelChar: 8.5,
            nodeMinWidth: 0,
        },
        maxNodesPerLevel: 2,
    } as unknown as dashql.buffers.view.DerivedPlanLayoutConfigT,
    operators,
    edges: [
        {
            id: 10n,
            childOperator: 0,
            parentOperator: 1,
            outputCardinalityEstimated: 10,
            outputCardinalityProduced: null,
            path: 'M 40 40 L 160 40',
        },
        {
            id: 11n,
            childOperator: 1,
            parentOperator: 2,
            outputCardinalityEstimated: 10,
            outputCardinalityProduced: null,
            path: 'M 160 40 L 280 40',
        },
    ],
    crossEdges: [
        {
            id: 12n,
            sourceOperator: 0,
            targetOperator: 2,
            kind: 'reference',
            properties: {},
            path: 'M 40 40 C 40 0, 280 0, 280 40',
        },
    ],
    fragments: [],
    pipelines: [],
};

vi.mock('./plan_scene.js', async importOriginal => ({
    ...await importOriginal<typeof import('./plan_scene.js')>(),
    materializePlanScene: () => scene,
}));

describe('PlanView keyboard navigation', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        ResizeObserverMock.reset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<PlanView plan={{} as dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel>} />));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.getElementById('__dashqlPortalRoot__')?.remove();
    });

    function key(target: Element, value: string) {
        act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
    }

    function highlightedEdgeIds(attribute: string): string[] {
        return [...container.querySelectorAll(`[${attribute}]`)].map(edge => edge.getAttribute(attribute)!);
    }

    function operator(id: number): Element {
        return container.querySelector(`[data-plan-operator-id="${id}"]`)!;
    }

    it('moves the selected operator with arrow keys instead of panning', () => {
        const viewport = container.querySelector<HTMLElement>('[role="region"]')!;
        key(viewport, 'ArrowRight');
        expect(container.querySelector('[data-plan-operator-id="0"]')?.getAttribute('data-selected')).toEqual('true');

        key(container.querySelector('[data-plan-operator-id="0"]')!, 'ArrowRight');
        expect(container.querySelector('[data-plan-operator-id="1"]')?.getAttribute('data-selected')).toEqual('true');
    });

    it('highlights every inbound and outbound edge while navigating with arrow keys', () => {
        const viewport = container.querySelector<HTMLElement>('[role="region"]')!;
        key(viewport, 'ArrowRight');
        expect(highlightedEdgeIds('data-plan-edge-highlight-id')).toEqual(['10']);
        expect(highlightedEdgeIds('data-plan-cross-edge-highlight-id')).toEqual(['12']);
        expect(operator(0).getAttribute('data-highlighted-output-port')).toEqual('true');
        expect(operator(1).getAttribute('data-highlighted-input-port')).toEqual('true');
        expect(operator(2).getAttribute('data-highlighted-input-port')).toEqual('true');

        key(operator(0), 'ArrowRight');
        expect(highlightedEdgeIds('data-plan-edge-highlight-id')).toEqual(['10', '11']);
        expect(highlightedEdgeIds('data-plan-cross-edge-highlight-id')).toEqual([]);
        expect(operator(0).getAttribute('data-highlighted-output-port')).toEqual('true');
        expect(operator(1).getAttribute('data-highlighted-output-port')).toEqual('true');
        expect(operator(1).getAttribute('data-highlighted-input-port')).toEqual('true');
        expect(operator(2).getAttribute('data-highlighted-input-port')).toEqual('true');
    });

    it('highlights every inbound and outbound edge when clicking an operator', () => {
        const operator = container.querySelector('[data-plan-operator-id="2"]')!;
        act(() => operator.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));

        expect(operator.getAttribute('data-selected')).toEqual('true');
        expect(highlightedEdgeIds('data-plan-edge-highlight-id')).toEqual(['11']);
        expect(highlightedEdgeIds('data-plan-cross-edge-highlight-id')).toEqual(['12']);
        expect(container.querySelector('[data-plan-operator-id="0"]')?.getAttribute('data-highlighted-output-port')).toEqual('true');
        expect(container.querySelector('[data-plan-operator-id="1"]')?.getAttribute('data-highlighted-output-port')).toEqual('true');
        expect(operator.getAttribute('data-highlighted-input-port')).toEqual('true');
    });

    it('focuses the plan viewport on mount when requested', () => {
        act(() => root.render(
            <PlanView plan={{} as dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel>} autoFocus />,
        ));

        expect(document.activeElement).toBe(container.querySelector('[role="region"]'));
    });

    it('toggles the selected operator properties with Enter', () => {
        const viewport = container.querySelector<HTMLElement>('[role="region"]')!;
        key(viewport, 'ArrowRight');
        const selected = container.querySelector('[data-plan-operator-id="0"]')!;

        key(selected, 'Enter');
        expect(document.querySelector('[aria-label="Scan orders properties"]')).not.toBeNull();
        expect(selected.getAttribute('aria-expanded')).toEqual('true');

        key(selected, 'Enter');
        expect(document.querySelector('[aria-label="Scan orders properties"]')).toBeNull();
        expect(selected.getAttribute('aria-expanded')).toEqual('false');
    });

    it('closes only the operator properties on Escape', () => {
        const viewport = container.querySelector<HTMLElement>('[role="region"]')!;
        key(viewport, 'ArrowRight');
        const selected = container.querySelector('[data-plan-operator-id="0"]')!;
        key(selected, 'Enter');
        expect(document.querySelector('[aria-label="Scan orders properties"]')).not.toBeNull();

        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        act(() => selected.dispatchEvent(escape));

        expect(document.querySelector('[aria-label="Scan orders properties"]')).toBeNull();
        expect(escape.defaultPrevented).toEqual(true);
        expect(container.querySelector('[role="region"]')).not.toBeNull();
    });

    it('renders occupied CSS ports on the card boundary', () => {
        const first = container.querySelector('[data-plan-operator-id="0"]')!;
        const second = container.querySelector('[data-plan-operator-id="1"]')!;

        expect(first.querySelector('[data-plan-operator-frame]')).not.toBeNull();
        expect(first.querySelector('[data-plan-port="output"]')?.getAttribute('aria-hidden')).toEqual('true');
        expect(first.querySelector('[data-plan-port="input"]')).toBeNull();
        expect(second.querySelector('[data-plan-port="input"]')?.getAttribute('aria-hidden')).toEqual('true');
        expect(second.querySelector('[data-plan-port="output"]')?.getAttribute('aria-hidden')).toEqual('true');
    });
});
