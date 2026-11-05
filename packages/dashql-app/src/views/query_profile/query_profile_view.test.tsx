import * as React from 'react';

import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as dashql from '@ankoh/dashql-core';
import { ResizeObserverMock } from '../../tests/mocks/view_mocks.js';
import { estimateRelativeDifference, type ProfileScene, type ProfileSceneOperator } from './profile_scene.js';
import { formatCpuShare, formatEstimateSymbol, formatFragmentMetrics, formatShortBytes, placeOperatorAnnotation, QueryProfileView, type QueryProfileViewDependencies } from './query_profile_view.js';
import { ProfileExecutionState } from '../../query/profile_execution_state.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

const NO_SLOT = 0xFFFFFFFF;

/// The actual rows over the edges (the output of their child operators), null if unknown
const actualRows: Array<number | null> = [null, null];

/// The execution state with the actual rows as the output of the child operators of the edges
function executionOf(rows: Array<number | null>): ProfileExecutionState {
    const view = dashql.buffers.profile;
    const operators = rows.map(value => value == null ? undefined : {
        status: view.ProfileExecutionStatus.SUCCEEDED,
        stats: new view.ProfileStatsT(view.ProfileStatsField.TUPLES_OUT, 0n, 0n, 0n, BigInt(value)),
    });
    return new ProfileExecutionState(null, [], [], [], operators);
}

/// The execution state with the CPU time, memory and spilled bytes of the operators, null if not reported
function executionWithCosts(costs: Array<{ cpuUs?: number; memory?: number; spilled?: number } | null>): ProfileExecutionState {
    const view = dashql.buffers.profile;
    const operators = costs.map(cost => {
        if (cost == null) return undefined;
        const stats = new view.ProfileStatsT();
        if (cost.cpuUs != null) {
            stats.reported |= view.ProfileStatsField.CPU_TIME;
            stats.cpuTimeUs = BigInt(cost.cpuUs);
        }
        if (cost.memory != null) {
            stats.reported |= view.ProfileStatsField.MEMORY_BYTES;
            stats.memoryBytes = BigInt(cost.memory);
        }
        if (cost.spilled != null) {
            stats.reported |= view.ProfileStatsField.SPILLED_BYTES;
            stats.spilledBytes = BigInt(cost.spilled);
        }
        return { status: view.ProfileExecutionStatus.SUCCEEDED, stats };
    });
    return new ProfileExecutionState(null, [], [], [], operators);
}

const operators: ProfileSceneOperator[] = [
    {
        id: 0,
        kind: dashql.buffers.profile.ProfileOperatorKind.OTHER,
        typeName: null,
        label: 'Scan orders',
        displayLabel: 'Scan orders',
        rect: { x: 40, y: 40, width: 100, height: 32 },
        ports: 1,
        estimatedRows: 10,
        fragment: 0xFFFFFFFF,
        properties: { table: 'orders' },
    },
    {
        id: 1,
        kind: dashql.buffers.profile.ProfileOperatorKind.OTHER,
        typeName: null,
        label: 'Project total',
        displayLabel: 'Project total',
        rect: { x: 160, y: 40, width: 100, height: 32 },
        ports: 3,
        estimatedRows: 10,
        fragment: 0xFFFFFFFF,
        properties: { expression: 'price * quantity' },
    },
    {
        id: 2,
        kind: dashql.buffers.profile.ProfileOperatorKind.OTHER,
        typeName: null,
        label: 'Return results',
        displayLabel: 'Return results',
        rect: { x: 280, y: 40, width: 100, height: 32 },
        ports: 2,
        estimatedRows: 10,
        fragment: 0xFFFFFFFF,
        properties: {},
    },
];

const scene: ProfileScene = {
    width: 0,
    height: 0,
    leftToRight: false,
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
    } as unknown as dashql.buffers.profile.DerivedProfileLayoutConfigT,
    operators,
    edges: [
        {
            id: 10,
            childOperator: 0,
            slot: NO_SLOT,
            parentOperator: 1,
            outputCardinalityEstimated: 10,
            path: 'M 40 40 L 160 40',
        },
        {
            id: 11,
            childOperator: 1,
            slot: NO_SLOT,
            parentOperator: 2,
            outputCardinalityEstimated: 10,
            path: 'M 160 40 L 280 40',
        },
    ],
    crossEdges: [
        {
            id: 12,
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

const dependencies: QueryProfileViewDependencies = {
    materializeProfileScene: () => scene,
};

describe('placeOperatorAnnotation', () => {
    // The operator spans 40..160 x 34..66
    const rect = { x: 100, y: 50, width: 120, height: 32 };

    it('starts the annotation after the left padding of the operator, vertically centered', () => {
        expect(placeOperatorAnnotation({ rect }, { nodePaddingLeft: 12 })).toEqual({ x: 52, y: 50 });
    });
});

describe('formatCpuShare', () => {
    it('rounds to whole percent and marks a share below 1%', () => {
        expect([0, 0.004, 0.01, 0.384, 1].map(formatCpuShare)).toEqual(['0%', '<1%', '1%', '38%', '100%']);
    });
});

describe('formatShortBytes', () => {
    it('keeps the bytes to at most 4 characters', () => {
        expect([0, 999, 1234, 123_456, 999_600, 12_000_000, 3.4e11].map(formatShortBytes))
            .toEqual(['0B', '999B', '1.2K', '120K', '1M', '12M', '340G']);
    });
});

describe('formatEstimateSymbol', () => {
    it('maps estimate-relative differences to seven ordered bands', () => {
        expect([-1, -0.5, -0.25, -0.05, 0, 0.05, 0.25, 0.5, 2].map(value => formatEstimateSymbol(value)))
            .toEqual(['>>', '>>', '>', '~', '=', '~', '<', '<<', '<<']);
    });

    it('treats absolute differences up to 100 rows as approximate', () => {
        expect(formatEstimateSymbol(2, 100)).toEqual('~');
        expect(formatEstimateSymbol(-1, 100)).toEqual('~');
        expect(formatEstimateSymbol(2, 101)).toEqual('<<');
    });
});

describe('QueryProfileView keyboard navigation', () => {
    let container: HTMLDivElement;
    let root: Root;
    const plan = {} as dashql.FlatBufferPtr<dashql.buffers.profile.QueryProfile>;

    beforeEach(() => {
        ResizeObserverMock.reset();
        scene.edges[0].outputCardinalityEstimated = 10;
        actualRows[0] = null;
        scene.edges[1].outputCardinalityEstimated = 10;
        actualRows[1] = null;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<QueryProfileView plan={plan} execution={executionOf(actualRows)} dependencies={dependencies} />));
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

    function edge(id: number): SVGPathElement {
        return container.querySelector<SVGPathElement>(`[data-plan-edge-id="${id}"]`)!;
    }

    function badge(id: number): SVGGElement | null {
        return container.querySelector<SVGGElement>(`[data-plan-edge-badge-id="${id}"]`);
    }

    function renderPlan(edgeRendering?: React.ComponentProps<typeof QueryProfileView>['edgeRendering']) {
        // The tests mutate the shared scene fixture in place, the view memoizes derived edges per scene
        const freshScene: QueryProfileViewDependencies = { ...dependencies, materializeProfileScene: () => ({ ...scene }) };
        act(() => root.render(<QueryProfileView plan={plan} execution={executionOf(actualRows)} edgeRendering={edgeRendering} dependencies={freshScene} />));
    }

    function annotationButton(mode: 'plain' | 'rows' | 'estimates' | 'accuracy' | 'cpu' | 'memory'): HTMLButtonElement {
        return container.querySelector<HTMLButtonElement>(`[data-testid="plan-annotation-${mode}"]`)!;
    }

    function annotationLabels(): string[] {
        return [...container.querySelectorAll('[data-testid^="plan-annotation-"]')].map(button => button.textContent ?? '');
    }

    function selectAnnotation(mode: 'plain' | 'rows' | 'estimates' | 'accuracy' | 'cpu' | 'memory') {
        const button = annotationButton(mode);
        act(() => button.click());
        return button;
    }

    function operatorBadge(id: number): SVGGElement | null {
        return container.querySelector<SVGGElement>(`[data-plan-operator-badge-id="${id}"]`);
    }

    function renderCosts(costs: Parameters<typeof executionWithCosts>[0]) {
        act(() => root.render(<QueryProfileView plan={plan} execution={executionWithCosts(costs)} dependencies={dependencies} />));
    }

    function rowsLegend(): HTMLElement | null {
        return container.querySelector<HTMLElement>('[data-testid="plan-rows-legend"]');
    }

    function accuracyLegend(): HTMLElement | null {
        return container.querySelector<HTMLElement>('[data-testid="plan-accuracy-legend"]');
    }

    function inspector(): HTMLElement | null {
        return document.querySelector<HTMLElement>('[data-testid="plan-operator-inspector"]');
    }

    function expectedEstimateSymbol(estimated: number, actual: number): string {
        return formatEstimateSymbol(estimateRelativeDifference(estimated, actual), Math.abs(actual - estimated));
    }

    it('fills the height of a container of fixed height', () => {
        container.style.height = '240px';
        act(() => root.render(<QueryProfileView plan={plan} execution={executionOf(actualRows)} dependencies={dependencies} fill />));
        const viewport = container.querySelector<HTMLElement>('[role="region"]')!;
        expect(viewport.getAttribute('data-fill')).toEqual('true');
        expect(viewport.getBoundingClientRect().height).toBeCloseTo(240);
    });

    it('starts with the estimated rows of a plan without actual rows', () => {
        expect(badge(10)?.textContent).toEqual('10');
        expect(badge(10)?.getAttribute('aria-label')).toEqual('Estimated rows 10');
        expect(annotationButton('estimates').getAttribute('aria-current')).toEqual('true');
        expect(rowsLegend()).not.toBeNull();
    });

    it('offers no Rows and no Accuracy before actual rows arrive', () => {
        expect(annotationLabels()).toEqual(['Plain', 'Estimates']);
    });

    it('offers no Estimates and no Accuracy without estimates', () => {
        scene.edges[0].outputCardinalityEstimated = null;
        scene.edges[1].outputCardinalityEstimated = null;
        actualRows[0] = 50;
        renderPlan();
        expect(annotationLabels()).toEqual(['Plain', 'Rows']);
        expect(annotationButton('rows').getAttribute('aria-current')).toEqual('true');
    });

    it('offers CPU and Memory only if an operator reports them', () => {
        renderCosts([{ cpuUs: 10 }, null, null]);
        expect(annotationLabels()).toEqual(['Plain', 'Estimates', 'CPU']);
        renderCosts([{ memory: 10 }, null, null]);
        expect(annotationLabels()).toEqual(['Plain', 'Estimates', 'Memory']);
    });

    it('falls back to the default mode when the chosen one has no data anymore', () => {
        renderCosts([{ cpuUs: 10 }, null, null]);
        selectAnnotation('cpu');
        expect(operatorBadge(0)).not.toBeNull();
        renderCosts([null, null, null]);
        expect(annotationButton('estimates').getAttribute('aria-current')).toEqual('true');
        expect(badge(10)?.textContent).toEqual('10');
    });

    it('renders actual rows in Rows mode when available', () => {
        actualRows[0] = 100;
        actualRows[1] = 1;
        renderPlan();

        // The row count of the edge sits in the annotation slot of its child
        expect(badge(10)?.getAttribute('transform')).toEqual('translate(2, 40)');
        expect(badge(10)?.textContent).toEqual('100');
        expect(badge(10)?.querySelector('rect')?.getAttribute('fill')).not.toBeNull();
        expect(badge(10)?.getAttribute('data-highlighted')).toBeNull();
        expect(rowsLegend()).not.toBeNull();
    });

    it('switches between Plain, Rows, Estimates and Accuracy annotations', () => {
        actualRows[0] = 100;
        renderPlan();
        expect(badge(10)).not.toBeNull();
        expect(rowsLegend()).not.toBeNull();

        const plain = selectAnnotation('plain');

        expect(badge(10)).toBeNull();
        expect(accuracyLegend()).toBeNull();
        expect(rowsLegend()).toBeNull();
        expect(plain.getAttribute('aria-current')).toEqual('true');

        selectAnnotation('accuracy');
        expect(badge(10)).not.toBeNull();
        expect(accuracyLegend()).not.toBeNull();
        expect(rowsLegend()).toBeNull();
        expect(badge(10)?.textContent).toEqual(expectedEstimateSymbol(10, 100));
        expect(badge(10)?.getAttribute('aria-label')).toBeTruthy();

        selectAnnotation('estimates');
        expect(badge(10)?.textContent).toEqual('10');
        expect(rowsLegend()).not.toBeNull();
        expect(accuracyLegend()).toBeNull();

        selectAnnotation('rows');
        expect(badge(10)?.textContent).toEqual('100');
        expect(rowsLegend()).not.toBeNull();
        expect(accuracyLegend()).toBeNull();
    });

    it('shows the actual rows only in Rows mode and the estimates only in Estimates mode', () => {
        scene.edges[0].outputCardinalityEstimated = 100;
        scene.edges[1].outputCardinalityEstimated = 1;
        actualRows[0] = 50;
        renderPlan();

        expect(annotationButton('rows').getAttribute('aria-current')).toEqual('true');
        expect(badge(10)?.textContent).toEqual('50');
        expect(badge(11)).toBeNull();

        selectAnnotation('estimates');
        expect(badge(10)?.textContent).toEqual('100');
        expect(badge(11)?.textContent).toEqual('1');
    });

    it('shows no estimate of an edge without one', () => {
        scene.edges[0].outputCardinalityEstimated = null;
        actualRows[0] = 50;
        renderPlan();
        expect(badge(10)?.textContent).toEqual('50');

        selectAnnotation('estimates');
        expect(badge(10)).toBeNull();
        expect(badge(11)?.textContent).toEqual('10');
        // No edge has both, there is nothing to compare
        expect(annotationButton('accuracy')).toBeNull();
    });

    it('colors actual and estimated rows on one scale', () => {
        scene.edges[0].outputCardinalityEstimated = 100;
        actualRows[0] = 1;
        renderPlan();
        const fill = () => badge(10)?.querySelector('rect')?.getAttribute('fill');
        const actualFill = fill();
        selectAnnotation('estimates');
        expect(fill()).not.toEqual(actualFill);
        expect(fill()).toEqual('rgb(73, 0, 106)');
    });

    it('uses the sequential RdPu scale for row counts', () => {
        scene.edges[0].outputCardinalityEstimated = 0;
        scene.edges[1].outputCardinalityEstimated = 100;
        renderPlan();

        expect(badge(10)?.querySelector('rect')?.getAttribute('fill')).toEqual('rgb(255, 247, 243)');
        expect(badge(11)?.querySelector('rect')?.getAttribute('fill')).toEqual('rgb(73, 0, 106)');
    });

    it('uses the comparison scale for badge fill, adaptive text, and a gray border', () => {
        scene.edges[0].outputCardinalityEstimated = 200;
        actualRows[0] = 0;
        scene.edges[1].outputCardinalityEstimated = 0;
        actualRows[1] = 200;
        renderPlan();
        selectAnnotation('accuracy');

        expect(badge(10)?.querySelector('rect')?.getAttribute('fill')).toEqual('rgb(5, 48, 97)');
        expect(badge(10)?.querySelector<SVGElement>('rect')?.style.stroke).toEqual('var(--color_border)');
        expect(badge(10)?.querySelector('text')?.getAttribute('fill')).toEqual('#ffffff');
        expect(badge(11)?.querySelector('rect')?.getAttribute('fill')).toEqual('rgb(103, 0, 31)');
        expect(badge(11)?.querySelector('text')?.getAttribute('fill')).toEqual('#ffffff');
        expect(badge(10)?.textContent).toEqual(expectedEstimateSymbol(200, 0));
        expect(badge(11)?.textContent).toEqual(expectedEstimateSymbol(0, 200));

        actualRows[0] = 200;
        renderPlan();
        expect(badge(10)?.querySelector('rect')?.getAttribute('fill')).toEqual('rgb(242, 239, 238)');
        expect(badge(10)?.querySelector('text')?.getAttribute('fill')).toEqual('#000000');
    });

    it('shows the CPU share of every operator that reports CPU time, the root too', () => {
        renderCosts([{ cpuUs: 100_000 }, { cpuUs: 300_000 }, null]);
        selectAnnotation('cpu');

        expect(badge(10)).toBeNull();
        expect(operatorBadge(0)?.textContent).toEqual('25%');
        expect(operatorBadge(1)?.textContent).toEqual('75%');
        expect(operatorBadge(2)).toBeNull();
        expect(operatorBadge(0)?.getAttribute('aria-label')).toEqual('CPU 100 ms, 25% of the CPU time of all operators');
        // The operator with the most CPU time gets the end of the scale
        expect(operatorBadge(1)?.querySelector('rect')?.getAttribute('fill')).toEqual('rgb(127, 0, 0)');
        expect(container.querySelector('[data-testid="plan-cpu-legend"]')).not.toBeNull();
    });

    it('shows the memory of every operator and marks the ones that spilled', () => {
        renderCosts([{ memory: 0 }, { memory: 12_000_000, spilled: 4_000_000 }, { cpuUs: 10 }]);
        selectAnnotation('memory');

        expect(operatorBadge(0)?.textContent).toEqual('0B');
        expect(operatorBadge(1)?.textContent).toEqual('12M');
        expect(operatorBadge(2)).toBeNull();
        expect(operatorBadge(0)?.getAttribute('data-spilled')).toBeNull();
        expect(operatorBadge(1)?.getAttribute('data-spilled')).toEqual('true');
        expect(operatorBadge(1)?.getAttribute('aria-label')).toEqual('Memory 12 MB, spilled 4 MB to disk');
        expect(container.querySelector('[data-testid="plan-memory-legend"]')?.textContent).toContain('Spilled to disk');
    });

    it('leaves out the spill note of the memory legend without spilled operators', () => {
        renderCosts([{ memory: 1000, spilled: 0 }, null, null]);
        selectAnnotation('memory');
        expect(operatorBadge(0)?.textContent).toEqual('1K');
        expect(container.querySelector('[data-testid="plan-memory-legend"]')?.textContent).not.toContain('Spilled');
    });

    it('highlights the operator annotation of the selected operator', () => {
        renderCosts([{ cpuUs: 1 }, { cpuUs: 1 }, null]);
        selectAnnotation('cpu');
        act(() => operator(0).dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(operatorBadge(0)?.getAttribute('data-highlighted')).toEqual('true');
        expect(operatorBadge(1)?.getAttribute('data-highlighted')).toBeNull();
    });

    it('supports a custom edge color interpolator', () => {
        scene.edges[0].outputCardinalityEstimated = 100;
        actualRows[0] = 0;
        scene.edges[1].outputCardinalityEstimated = 0;
        actualRows[1] = 100;
        renderPlan({ colorScheme: value => value < 0.5 ? '#000000' : '#ffffff' });
        selectAnnotation('accuracy');

        expect(badge(10)?.querySelector('rect')?.getAttribute('fill')).toEqual('#000000');
        expect(badge(11)?.querySelector('rect')?.getAttribute('fill')).toEqual('#ffffff');
        const gradient = accuracyLegend()?.querySelector<HTMLElement>('[data-testid="plan-legend-gradient"]')?.style.backgroundImage;
        expect(gradient).toContain('rgb(0, 0, 0)');
        expect(gradient).toContain('rgb(255, 255, 255)');
    });

    it('paints the selected edge and its badge blue', () => {
        actualRows[0] = 100;
        actualRows[1] = 10;
        renderPlan();
        const viewport = container.querySelector<HTMLElement>('[role="region"]')!;
        key(viewport, 'ArrowRight');

        const highlight = container.querySelector('[data-plan-edge-highlight-id="10"]')!;
        expect(edge(10).compareDocumentPosition(highlight) & Node.DOCUMENT_POSITION_FOLLOWING).not.toEqual(0);
        expect(badge(10)?.getAttribute('data-highlighted')).toEqual('true');
        expect(badge(11)?.getAttribute('data-highlighted')).toBeNull();
        expect(badge(10)?.querySelector<SVGElement>('rect')?.style.fill).toEqual('var(--color_accent_emphasis)');
        expect(badge(10)?.querySelector<SVGElement>('rect')?.style.stroke).toEqual('var(--color_accent_emphasis)');
        expect(badge(10)?.querySelector<SVGElement>('text')?.style.fill).toEqual('var(--color_fg_on_emphasis)');
    });

    it('moves the selected operator with arrow keys instead of panning', () => {
        const viewport = container.querySelector<HTMLElement>('[role="region"]')!;
        key(viewport, 'ArrowRight');
        expect(container.querySelector('[data-plan-operator-id="0"]')?.getAttribute('data-selected')).toEqual('true');
        expect(inspector()).toBeNull();

        key(container.querySelector('[data-plan-operator-id="0"]')!, 'ArrowRight');
        expect(container.querySelector('[data-plan-operator-id="1"]')?.getAttribute('data-selected')).toEqual('true');
        expect(inspector()).toBeNull();
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
            <QueryProfileView plan={plan} autoFocus dependencies={dependencies} />,
        ));

        expect(document.activeElement).toBe(container.querySelector('[role="region"]'));
    });

    it('shows the rotate button only when the plan can be rotated', () => {
        expect(container.querySelector('[data-testid="plan-rotate"]')).toBeNull();

        const onRotate = vi.fn();
        act(() => root.render(<QueryProfileView plan={plan} execution={executionOf(actualRows)} onRotate={onRotate} dependencies={dependencies} />));
        const node = container.querySelector('[data-plan-operator-id="1"]')!;
        act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })));
        expect(inspector()).not.toBeNull();

        const button = container.querySelector<HTMLButtonElement>('[data-testid="plan-rotate"]')!;
        expect(button.getAttribute('aria-label')).toEqual('Rotate plan to left-to-right');
        act(() => button.click());
        expect(onRotate).toHaveBeenCalledTimes(1);
        expect(inspector()).toBeNull();

        key(container.querySelector<HTMLElement>('[role="region"]')!, 'r');
        expect(onRotate).toHaveBeenCalledTimes(2);
    });

    it('toggles the selected operator properties with Enter', () => {
        const viewport = container.querySelector<HTMLElement>('[role="region"]')!;
        key(viewport, 'ArrowRight');
        const selected = container.querySelector('[data-plan-operator-id="0"]')!;

        key(selected, 'Enter');
        expect(inspector()?.textContent).toContain('Scan orders');
        expect(selected.getAttribute('aria-expanded')).toEqual('true');

        key(selected, 'Enter');
        expect(inspector()).toBeNull();
        expect(selected.getAttribute('aria-expanded')).toEqual('false');
    });

    it('opens operator properties immediately when clicked', () => {
        const node = container.querySelector('[data-plan-operator-id="1"]')!;
        act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })));

        expect(node.getAttribute('data-selected')).toEqual('true');
        expect(node.getAttribute('aria-expanded')).toEqual('true');
        expect(inspector()?.textContent).toContain('Project total');
    });

    it('shows the next operator properties when arrow navigation continues with details open', () => {
        const first = container.querySelector('[data-plan-operator-id="0"]')!;
        act(() => first.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })));
        expect(inspector()?.textContent).toContain('Scan orders');

        key(first, 'ArrowRight');

        expect(container.querySelector('[data-plan-operator-id="1"]')?.getAttribute('data-selected')).toEqual('true');
        expect(inspector()?.textContent).not.toContain('Scan orders');
        expect(inspector()?.textContent).toContain('Project total');
    });

    it('closes only the operator properties on Escape', () => {
        const viewport = container.querySelector<HTMLElement>('[role="region"]')!;
        key(viewport, 'ArrowRight');
        const selected = container.querySelector('[data-plan-operator-id="0"]')!;
        key(selected, 'Enter');
        expect(inspector()).not.toBeNull();

        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        act(() => selected.dispatchEvent(escape));

        expect(inspector()).toBeNull();
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

describe('QueryProfileView fragment progress', () => {
    const view = dashql.buffers.profile;
    const plan = {} as dashql.FlatBufferPtr<dashql.buffers.profile.QueryProfile>;
    const progressScene: ProfileScene = {
        ...scene,
        fragments: [
            { id: 0, operatorIds: [0, 1], path: 'M 0 0 L 200 0 L 200 80 L 0 80 Z' },
            { id: 1, operatorIds: [2], path: 'M 240 0 L 320 0 L 320 80 L 240 80 Z' },
        ],
    };
    const fragmentDependencies: QueryProfileViewDependencies = { ...dependencies, materializeProfileScene: () => progressScene };

    /// The state of a fragment with work done of work total
    function fragment(status: dashql.buffers.profile.ProfileExecutionStatus, done: number, total: number) {
        const stats = new view.ProfileStatsT();
        stats.reported = view.ProfileStatsField.WORK_DONE | view.ProfileStatsField.WORK_TOTAL;
        stats.workDone = BigInt(done);
        stats.workTotal = BigInt(total);
        return { status, stats };
    }

    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        ResizeObserverMock.reset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    /// The state of a fragment with processed rows and bytes, CPU time and work
    function fragmentWithMetrics(status: dashql.buffers.profile.ProfileExecutionStatus, rows: number, bytes: number, cpuUs: number, done: number, total: number) {
        const state = fragment(status, done, total);
        state.stats.reported |= view.ProfileStatsField.TUPLES_IN | view.ProfileStatsField.BYTES_IN | view.ProfileStatsField.CPU_TIME;
        state.stats.tuplesIn = BigInt(rows);
        state.stats.bytesIn = BigInt(bytes);
        state.stats.cpuTimeUs = BigInt(cpuUs);
        return state;
    }

    it('runs the progress of a running fragment along its contour', () => {
        const execution = new ProfileExecutionState(null, [
            fragment(view.ProfileExecutionStatus.RUNNING, 4, 8),
            fragment(view.ProfileExecutionStatus.SUCCEEDED, 8, 8),
        ], [], [], []);
        act(() => root.render(<QueryProfileView plan={plan} execution={execution} showProgress dependencies={fragmentDependencies} />));
        const progress = [...container.querySelectorAll('[data-testid="fragment-progress"]')];
        expect(progress.map(path => [path.getAttribute('d'), path.getAttribute('stroke-dasharray')]))
            .toEqual([['M 0 0 L 200 0 L 200 80 L 0 80 Z', '50 100']]);
    });

    it('reads out the metrics of every fragment without a card on its contour', () => {
        const execution = new ProfileExecutionState(null, [
            fragmentWithMetrics(view.ProfileExecutionStatus.RUNNING, 7531357, 241696, 4170000, 12, 37),
            fragmentWithMetrics(view.ProfileExecutionStatus.SUCCEEDED, 150000, 0, 166000, 16, 16),
        ], [], [], []);
        act(() => root.render(<QueryProfileView plan={plan} execution={execution} showProgress dependencies={fragmentDependencies} />));
        expect(container.querySelector('[data-testid="fragment-metrics"]')).toBeNull();
        // 0 bytes are left out, Trino reports no bytes for some connectors
        expect(container.querySelector('[aria-label^="Fragment 1, 7531357 rows, 242 kB, 4.17 s CPU time, 12 of 37 splits,"]')).not.toBeNull();
        expect(container.querySelector('[aria-label^="Fragment 2, 150000 rows, 166 ms CPU time,"]')).not.toBeNull();
    });

    it('leaves out the metrics that are still 0, except the rows of a succeeded fragment', () => {
        expect(formatFragmentMetrics(fragmentWithMetrics(view.ProfileExecutionStatus.RUNNING, 0, 0, 0, 0, 37))?.text).toEqual('0/37 splits');
        expect(formatFragmentMetrics(fragmentWithMetrics(view.ProfileExecutionStatus.SUCCEEDED, 0, 0, 0, 2, 2))?.text).toEqual('0 rows');
    });

    it('reads out no metrics of a fragment without reported statistics', () => {
        const execution = new ProfileExecutionState(null, [{ status: view.ProfileExecutionStatus.PENDING, stats: new view.ProfileStatsT() }], [], [], []);
        act(() => root.render(<QueryProfileView plan={plan} execution={execution} showProgress dependencies={fragmentDependencies} />));
        expect(container.querySelector('[aria-label^="Fragment 1, containing operators"]')).not.toBeNull();
    });

    it('shows the status of the operators first and replaces it with the row counts', () => {
        const execution = new ProfileExecutionState(null, [fragment(view.ProfileExecutionStatus.RUNNING, 4, 8)], [], [], []);
        act(() => root.render(<QueryProfileView plan={plan} execution={execution} showProgress dependencies={fragmentDependencies} />));
        const status = () => container.querySelector('[data-plan-operator-id="0"] [data-status]');
        const rows = () => container.querySelector('[data-plan-edge-badge-id="10"]');
        const button = (mode: string) => container.querySelector<HTMLButtonElement>(`[data-testid="plan-annotation-${mode}"]`)!;
        // The label is centered right of the annotation, the operator spans 0..100 with 12 pixels of padding
        const labelX = () => container.querySelector('[data-plan-operator-id="0"] text')?.getAttribute('x');
        // Without actual rows and statistics of the operators, only the estimates are there besides the status
        expect([...container.querySelectorAll('[data-testid^="plan-annotation-"]')].map(b => b.textContent))
            .toEqual(['Status', 'Plain', 'Estimates']);
        expect(button('status').getAttribute('aria-current')).toEqual('true');
        expect(status()).not.toBeNull();
        expect(rows()).toBeNull();
        expect(labelX()).toEqual(`${(12 + 14 + 88) / 2}`);

        act(() => button('estimates').click());
        expect(status()).toBeNull();
        expect(rows()?.textContent).toEqual('10');
        expect(labelX()).toEqual(`${(12 + 20 + 88) / 2}`);

        act(() => button('plain').click());
        expect(status()).toBeNull();
        expect(rows()).toBeNull();
        expect(labelX()).toEqual('50');
    });

    it('offers no status without the progress mode', () => {
        act(() => root.render(<QueryProfileView plan={plan} dependencies={fragmentDependencies} />));
        expect(container.querySelector('[data-testid="plan-annotation-status"]')).toBeNull();
        expect(container.querySelector<HTMLButtonElement>('[data-testid="plan-annotation-estimates"]')?.getAttribute('aria-current')).toEqual('true');
    });

    it('keeps the color of every fragment whatever its status, grey until colored', () => {
        const execution = new ProfileExecutionState(null, [
            fragment(view.ProfileExecutionStatus.SUCCEEDED, 8, 8),
            fragment(view.ProfileExecutionStatus.SUCCEEDED, 8, 8),
        ], [], [], []);
        act(() => root.render(<QueryProfileView plan={plan} execution={execution} showProgress dependencies={fragmentDependencies} />));
        const contours = [...container.querySelectorAll('[aria-label^="Fragment"]')];
        expect(contours.map(contour => contour.getAttribute('data-color'))).toEqual(['neutral', 'neutral']);
        expect(contours.map(contour => contour.querySelector('path')?.getAttribute('data-status'))).toEqual(['succeeded', 'succeeded']);

        // The paint button tells the fragments apart by color, and turns them grey again
        const toggle = container.querySelector<HTMLButtonElement>('[data-testid="plan-fragment-colors"]')!;
        expect(toggle.getAttribute('aria-pressed')).toEqual('false');
        act(() => toggle.click());
        expect(toggle.getAttribute('aria-pressed')).toEqual('true');
        expect(contours.map(contour => contour.getAttribute('data-color'))).toEqual(['0', '1']);
        act(() => toggle.click());
        expect(contours.map(contour => contour.getAttribute('data-color'))).toEqual(['neutral', 'neutral']);
    });

    it('shows no progress without the progress mode', () => {
        const execution = new ProfileExecutionState(null, [fragment(view.ProfileExecutionStatus.RUNNING, 4, 8)], [], [], []);
        act(() => root.render(<QueryProfileView plan={plan} execution={execution} dependencies={fragmentDependencies} />));
        expect(container.querySelector('[data-testid="fragment-progress"]')).toBeNull();
    });
});
