import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ResizeObserverMock } from '../test/view_mocks.js';
import { ShellNavBar } from './shell_navbar.js';

vi.mock('./internals.js', () => ({ ShellInternals: () => null }));
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

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
        act(() => root.render(<ShellNavBar engineVersion="1.0.0" onReset={onReset} />));

        const resetButton = container.querySelector<HTMLButtonElement>('button[aria-label="Reset shell"]');
        expect(resetButton).not.toBeNull();
        act(() => resetButton!.click());

        expect(onReset).toHaveBeenCalledOnce();
    });
});
