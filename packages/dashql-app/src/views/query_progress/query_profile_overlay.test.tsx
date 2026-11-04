import * as React from 'react';

import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryProfileOverlay } from './query_profile_overlay.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('QueryProfileOverlay', () => {
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

    it('shows the plan in a card and closes with the close button and Escape', () => {
        const onClose = vi.fn();
        act(() => root.render(
            <QueryProfileOverlay onClose={onClose}>
                <div data-testid="plan-viewer" />
            </QueryProfileOverlay>,
        ));
        const dialog = document.querySelector<HTMLElement>('[data-testid="query-profile-overlay"]')!;
        expect(dialog.getAttribute('aria-label')).toEqual('Query plan');
        expect(dialog.querySelector('[data-testid="plan-viewer"]')).not.toBeNull();

        act(() => document.querySelector<HTMLButtonElement>('[data-testid="query-profile-overlay-close"]')!.click());
        expect(onClose).toHaveBeenCalledTimes(1);

        act(() => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('expands to fill the window and restores its size', () => {
        act(() => root.render(
            <QueryProfileOverlay onClose={() => {}}>
                <div data-testid="plan-viewer" />
            </QueryProfileOverlay>,
        ));
        const overlay = document.querySelector<HTMLElement>('[data-testid="query-profile-overlay"]')!.parentElement!;
        const expand = document.querySelector<HTMLButtonElement>('[data-testid="query-profile-overlay-expand"]')!;
        expect(overlay.getAttribute('data-expanded')).toEqual('false');
        expect(expand.getAttribute('aria-pressed')).toEqual('false');

        act(() => expand.click());
        expect(overlay.getAttribute('data-expanded')).toEqual('true');
        expect(expand.getAttribute('aria-pressed')).toEqual('true');

        act(() => expand.click());
        expect(overlay.getAttribute('data-expanded')).toEqual('false');
    });
});
