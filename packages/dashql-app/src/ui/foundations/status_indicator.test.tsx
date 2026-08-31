import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { BinaryStatusIndicator, IndicatorStatus, StatusIndicator } from './status_indicator.js';

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

    function render(element: React.ReactElement): SVGElement {
        act(() => root.render(element));
        return container.querySelector('svg')!;
    }

    it.each([
        [IndicatorStatus.Running, '#9a6700'],
        [IndicatorStatus.Succeeded, '#1f883d'],
        [IndicatorStatus.Failed, '#cf222e'],
        [IndicatorStatus.None, '#6e7781'],
        [IndicatorStatus.Blocked, '#6e7781'],
        [IndicatorStatus.Skip, '#6e7781'],
    ])('uses the default color for status %s', (status, color) => {
        const svg = render(<StatusIndicator status={status} />);

        expect(svg.querySelector(`[fill="${color}"]`)).not.toBeNull();
    });

    it('uses success green only when a binary status is online', () => {
        let svg = render(<BinaryStatusIndicator online />);
        expect(svg.querySelector('[fill="#1f883d"]')).not.toBeNull();

        svg = render(<BinaryStatusIndicator online={false} />);
        expect(svg.querySelector('[fill="#6e7781"]')).not.toBeNull();
    });

    it('allows an explicit color override', () => {
        const svg = render(<StatusIndicator status={IndicatorStatus.Failed} fill="purple" />);

        expect(svg.querySelector('[fill="purple"]')).not.toBeNull();
    });
});
