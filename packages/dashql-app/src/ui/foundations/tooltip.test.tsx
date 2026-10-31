import * as React from 'react';

import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Tooltip } from './tooltip.js';

describe('Tooltip accessible naming', () => {
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

    it('preserves an explicit trigger label without adding a second label source', () => {
        act(() => root.render(
            <Tooltip text="Close" type="label">
                <button aria-label="Close" />
            </Tooltip>,
        ));

        const trigger = container.querySelector('button')!;
        expect(trigger.getAttribute('aria-label')).toBe('Close');
        expect(trigger.hasAttribute('aria-labelledby')).toBe(false);
    });

    it('labels an otherwise unnamed trigger with the tooltip text', () => {
        act(() => root.render(
            <Tooltip text="Close" type="label">
                <button />
            </Tooltip>,
        ));

        const trigger = container.querySelector('button')!;
        expect(trigger.getAttribute('aria-labelledby')).toBe(
            container.querySelector('[id]')!.id,
        );
    });

    it('leaves Escape to others once the browser closed the tooltip', () => {
        act(() => root.render(
            <Tooltip text="Build a chart" type="label">
                <button />
            </Tooltip>,
        ));
        const trigger = container.querySelector('button')!;
        const tooltip = container.querySelector('[aria-hidden="true"]') as HTMLElement;
        act(() => { trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null })); });
        expect(tooltip.matches(':popover-open')).toBe(true);
        // The browser closes an auto popover on its own, e.g. when another popover opens
        tooltip.hidePopover();

        // An overlay listens for Escape after the tooltip
        let escapes = 0;
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') escapes += 1; };
        document.addEventListener('keydown', onKeyDown);
        try {
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        } finally {
            document.removeEventListener('keydown', onKeyDown);
        }
        expect(escapes).toBe(1);
    });
});
