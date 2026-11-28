import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsoleLayout, type ConsoleLayoutProps } from './console_layout.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const TABS = [{ scriptKey: 1, label: 'alpha' }, { scriptKey: 2, label: 'beta' }];

describe('ConsoleLayout', () => {
    let root: ReturnType<typeof createTestRoot>;
    const show = (props: Partial<ConsoleLayoutProps>) => root.render(
        <ConsoleLayout
            tabs={TABS}
            activeTab={2}
            onSelectTab={vi.fn()}
            header={() => <div data-testid="header" />}
            editor={() => <div data-testid="editor" />}
            results={() => <div data-testid="results" />}
            sidebar={() => <div data-testid="sidebar-section" />}
            {...props}
        />,
    );
    const tabs = () => [...root.container.querySelectorAll<HTMLButtonElement>('[data-testid="console-tab"]')];
    const part = (testId: string) => root.container.querySelector(`[data-testid="${testId}"]`);

    beforeEach(() => { root = createTestRoot(); });
    afterEach(() => root.unmount());

    it('shows a tab per script and the parts of the active one', async () => {
        const onSelectTab = vi.fn();
        await show({ onSelectTab });
        expect(tabs().map(tab => tab.textContent)).toEqual(['alpha', 'beta']);
        expect(tabs().map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'true']);
        for (const testId of ['header', 'editor', 'results', 'sidebar-section']) expect(part(testId)).not.toBeNull();
        // The editor sits above the results, the sidebar next to them
        expect(part('editor')!.compareDocumentPosition(part('results')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(part('console-sidebar')!.contains(part('sidebar-section'))).toBe(true);
        act(() => tabs()[0]!.click());
        expect(onSelectTab).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('adds a script from the strip unless the workbook takes none', async () => {
        const onAddTab = vi.fn();
        await show({ onAddTab });
        act(() => root.container.querySelector<HTMLButtonElement>('[data-testid="console-add-script"]')!.click());
        expect(onAddTab).toHaveBeenCalledOnce();
        await show({ onAddTab: undefined });
        expect(part('console-add-script')).toBeNull();
    });

    it('shows no editor without scripts, the sidebar stays', async () => {
        await show({ tabs: [], activeTab: null });
        expect(part('console-empty')).not.toBeNull();
        expect(part('editor')).toBeNull();
        expect(part('sidebar-section')).not.toBeNull();
    });
});
