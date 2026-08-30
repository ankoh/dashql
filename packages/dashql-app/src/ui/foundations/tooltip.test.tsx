import * as React from 'react';

import { act } from 'react';
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
});
