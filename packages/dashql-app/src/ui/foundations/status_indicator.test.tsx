import * as React from 'react';
import { act } from '@dashql/browser-test-act';
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

    function renderColor(element: React.ReactElement): string | null {
        act(() => root.render(element));
        return container.querySelector('svg [fill]:not([fill="none"])')?.getAttribute('fill') ?? null;
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

    it('uses the success color only when a binary status is online', () => {
        const succeeded = renderColor(<StatusIndicator status={IndicatorStatus.Succeeded} />);
        const neutral = renderColor(<StatusIndicator status={IndicatorStatus.None} />);

        expect(renderColor(<BinaryStatusIndicator online />)).toBe(succeeded);
        expect(renderColor(<BinaryStatusIndicator online={false} />)).toBe(neutral);
    });

    it('allows an explicit color override', () => {
        expect(renderColor(<StatusIndicator status={IndicatorStatus.Failed} fill="purple" />)).toBe('purple');
    });
});
