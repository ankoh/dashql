import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';

import { ResizeObserverMock } from '@akohn/dashql-react/testing/resize_observer_mock';
import { ShellNavBar } from './shell_navbar.js';
import { FlavorProvider } from '../../config/flavor_provider.js';
import { applyFlavorToDocument } from '../../config/flavor_resolution.js';
import { DASHQL_FLAVOR, DBCOM_FLAVOR } from '../../config/flavors.js';

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

        expect(container.querySelector('[data-brand="hyper"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="shell-flavor-brand"]')).toBeNull();
    });

    it('shows the wordmark and tagline of a requested flavor', () => {
        act(() => root.render(
            <FlavorProvider requested={DBCOM_FLAVOR}>
                <ShellNavBar engineVersion="1.0.0" onReset={() => {}} Internals={EmptyInternals} />
            </FlavorProvider>,
        ));

        const brand = container.querySelector('[data-testid="shell-flavor-brand"]');
        expect(brand).not.toBeNull();
        expect(brand!.getAttribute('data-brand')).toBe(DBCOM_FLAVOR.id);
        expect(brand!.textContent).toContain(DBCOM_FLAVOR.tagline);
        expect(document.documentElement.dataset.flavor).toBe('dbcom');
        expect(document.title).toBe('Database.com');
        applyFlavorToDocument(DASHQL_FLAVOR);
    });
});
