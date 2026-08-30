import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotebookLoadingCard } from './notebook_loading_card.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('../../ui/navbar.js', () => ({ CompactNavBar: () => null }));
vi.mock('../../../ui/particle_flow/particle_flow_background.js', () => ({ ParticleFlowBackground: () => null }));

describe('NotebookLoadingCard', () => {
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

    it('shows indeterminate manifest loading and cancels', () => {
        const onCancel = vi.fn();
        act(() => root.render(
            <NotebookLoadingCard
                sourceUrl="https://example.com/dashql-notebook.json"
                progress={{ phase: 'manifest' }}
                onCancel={onCancel}
            />,
        ));

        expect(container.querySelector('h1')?.textContent).toBe('Loading Notebook');
        expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading notebook manifest');
        expect(container.querySelector('[role="progressbar"]')).toBeNull();
        expect(container.textContent).toContain('https://example.com/dashql-notebook.json');

        const cancel = container.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
        act(() => cancel.click());
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('shows determinate file and script progress after discovery', () => {
        act(() => root.render(
            <NotebookLoadingCard
                sourceUrl="https://example.com/dashql-notebook.json"
                progress={{
                    phase: 'files',
                    notebookName: 'Example',
                    notebookId: '4f741f53-d76f-4a6d-b1d8-c22aa85bd449',
                    completedFileCount: 5,
                    totalFileCount: 9,
                    completedScriptCount: 2,
                    totalScriptCount: 4,
                }}
                onCancel={() => { }}
            />,
        ));

        expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading scripts: 2 of 4');
        const progress = container.querySelector('[role="progressbar"]')!;
        expect(progress.getAttribute('aria-valuenow')).toBe('56');
        expect(progress.getAttribute('aria-valuetext')).toBe('5 of 9 files');
        expect(container.textContent).toContain('Example');
        expect(container.textContent).toContain('4f741f53-d76f-4a6d-b1d8-c22aa85bd449');
    });
});
