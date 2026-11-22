import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { MemoryRouter } from 'react-router-dom';

import { isWorkspacePath, NavRailPages } from './nav_rail.js';
import { FlavorProvider } from '../config/flavor_provider.js';
import { type AppFlavor, DASHQL_FLAVOR, DBCOM_FLAVOR } from '../config/flavors.js';
import { WorkbookViewModeProvider } from '../workbook/workbook_view_mode.js';

describe('Nav rail', () => {
    it('marks the workbook pages as the workspace', () => {
        expect(isWorkspacePath('/')).toBe(true);
        expect(isWorkspacePath('/workbook')).toBe(true);
        expect(isWorkspacePath('/workbooks/abc')).toBe(true);
    });

    it('leaves other pages outside the workspace', () => {
        expect(isWorkspacePath('/oauth')).toBe(false);
        expect(isWorkspacePath('/workbooksx')).toBe(false);
    });
});

describe('Nav rail pages', () => {
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

    // A workbook is open, so the rail shows the shell
    const render = (flavor: AppFlavor) => act(() => root.render(
        <MemoryRouter initialEntries={['/workbooks/abc']}>
            <FlavorProvider requested={flavor}>
                <WorkbookViewModeProvider>
                    <NavRailPages wide={true} />
                </WorkbookViewModeProvider>
            </FlavorProvider>
        </MemoryRouter>,
    ));
    const items = () => [...container.querySelectorAll('button, [role="separator"]')]
        .map(e => e.getAttribute('aria-label') ?? '|');
    /// The labels of the pages of a flavor, a separator between their groups
    const label = (page: AppFlavor['railPages'][number][number]) => page.type === 'upcoming' ? page.label : page.type === 'workspace' ? 'Workspace' : 'Shell';
    const groupedLabels = (flavor: AppFlavor) => flavor.railPages.flatMap((group, i) => [...(i > 0 ? ['|'] : []), ...group.map(label)]);

    it('lays out the pages of the dbcom flavor in groups', () => {
        render(DBCOM_FLAVOR);
        expect(items()).toEqual(groupedLabels(DBCOM_FLAVOR));
        const upcoming = DBCOM_FLAVOR.railPages.flat().filter(page => page.type === 'upcoming');
        for (const page of upcoming) {
            const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${page.label}"]`)!;
            expect(button.getAttribute('aria-disabled')).toBe('true');
            expect(button.textContent).toBe(page.label);
            expect(button.querySelector('use')?.getAttribute('xlink:href')).toMatch(new RegExp(`#${page.icon}$`));
        }
        expect(container.querySelector('button[aria-label="Workspace"]')!.getAttribute('aria-current')).toBe('page');
    });

    it('shows only the workspace and the shell for DashQL', () => {
        render(DASHQL_FLAVOR);
        expect(items()).toEqual(groupedLabels(DASHQL_FLAVOR));
    });
});
