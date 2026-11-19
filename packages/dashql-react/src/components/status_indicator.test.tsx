import * as React from 'react';
import { act } from '../testing/react_act.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { IndicatorStatus, StatusDot, StatusIndicator } from './status_indicator.js';

describe('StatusIndicator', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function renderColor(element: React.ReactElement): string | null {
        act(() => root.render(element));
        return container.querySelector('svg')?.style.color ?? null;
    }

    it('distinguishes running, succeeded, and failed and shares a neutral color otherwise', () => {
        const running = renderColor(<StatusIndicator status={IndicatorStatus.Running} />);
        const succeeded = renderColor(<StatusIndicator status={IndicatorStatus.Succeeded} />);
        const failed = renderColor(<StatusIndicator status={IndicatorStatus.Failed} />);
        const none = renderColor(<StatusIndicator status={IndicatorStatus.None} />);
        const blocked = renderColor(<StatusIndicator status={IndicatorStatus.Blocked} />);
        const skip = renderColor(<StatusIndicator status={IndicatorStatus.Skip} />);

        expect(new Set([running, succeeded, failed, none]).size).toBe(4);
        expect(blocked).toBe(none);
        expect(skip).toBe(none);
    });

    it('allows an explicit color override', () => {
        expect(renderColor(<StatusIndicator status={IndicatorStatus.Failed} fill="purple" />)).toBe('purple');
    });

    it('draws a status as a dot in the colors of the indicator', () => {
        const dot = (status: IndicatorStatus) => {
            act(() => root.render(<StatusDot status={status} size={6} />));
            return container.querySelector<HTMLElement>('span')!;
        };
        const svgColor = (status: IndicatorStatus) => renderColor(<StatusIndicator status={status} />);
        for (const status of [IndicatorStatus.Running, IndicatorStatus.Succeeded, IndicatorStatus.Failed, IndicatorStatus.None]) {
            expect(dot(status).style.backgroundColor).toBe(svgColor(status));
        }
        expect(dot(IndicatorStatus.Running).dataset.status).toBe('running');
        expect(getComputedStyle(dot(IndicatorStatus.Running)).animationName).not.toBe('none');
        expect(getComputedStyle(dot(IndicatorStatus.Succeeded)).animationName).toBe('none');
        expect(getComputedStyle(dot(IndicatorStatus.None)).opacity).toBe('0.5');
        expect(dot(IndicatorStatus.Failed).style.width).toBe('6px');
    });
});
