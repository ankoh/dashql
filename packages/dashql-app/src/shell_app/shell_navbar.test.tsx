import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';

import { ResizeObserverMock } from '../tests/mocks/view_mocks.js';
import { ShellNavBar } from './shell_navbar.js';
import { FlavorProvider } from '../app/flavor/flavor_provider.js';
import { applyFlavorToDocument } from '../app/flavor/flavor_resolution.js';
import { DASHQL_FLAVOR, SIDB_FLAVOR } from '../app/flavor/flavors.js';

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

const EmptyInternals = () => null;

describe('ShellNavBar', () => {
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

    it('resets the shell when the Hyper logo is clicked', () => {
        const onReset = vi.fn();
        act(() => root.render(
            <ShellNavBar engineVersion="1.0.0" onReset={onReset} Internals={EmptyInternals} />,
        ));

        const resetButton = container.querySelector<HTMLButtonElement>('[data-testid="shell-reset"]');
        expect(resetButton).not.toBeNull();
        act(() => resetButton!.click());

        expect(onReset).toHaveBeenCalledOnce();
    });

    it('shows the Hyper banner without a requested flavor', () => {
        act(() => root.render(
            <ShellNavBar engineVersion="1.0.0" onReset={() => {}} Internals={EmptyInternals} />,
        ));

        expect(container.querySelector('use')?.getAttribute('xlink:href')).toMatch(/#hyper_banner$/);
        expect(container.querySelector('[data-testid="shell-flavor-brand"]')).toBeNull();
    });

    it('shows the wordmark and tagline of a requested flavor', () => {
        act(() => root.render(
            <FlavorProvider requested={SIDB_FLAVOR}>
                <ShellNavBar engineVersion="1.0.0" onReset={() => {}} Internals={EmptyInternals} />
            </FlavorProvider>,
        ));

        const brand = container.querySelector('[data-testid="shell-flavor-brand"]');
        expect(brand).not.toBeNull();
        expect(brand!.querySelector('use')?.getAttribute('xlink:href')).toMatch(/#sidb$/);
        expect(brand!.textContent).toContain(SIDB_FLAVOR.tagline);
        expect(document.documentElement.dataset.flavor).toBe('sidb');
        expect(document.title).toBe('SIDB');
        applyFlavorToDocument(DASHQL_FLAVOR);
    });
});
