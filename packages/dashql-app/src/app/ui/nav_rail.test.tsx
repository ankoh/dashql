import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { MemoryRouter } from 'react-router-dom';

import { isWorkspacePath, NavRailPages } from './nav_rail.js';
import { FlavorProvider } from '../flavor/flavor_provider.js';
import { type AppFlavor, DASHQL_FLAVOR, SIDB_FLAVOR } from '../flavor/flavors.js';
import { SessionViewModeProvider } from '../session/ui/session_view_mode.js';

describe('Nav rail', () => {
    it('marks the session pages as the workspace', () => {
        expect(isWorkspacePath('/')).toBe(true);
        expect(isWorkspacePath('/session')).toBe(true);
        expect(isWorkspacePath('/sessions/abc')).toBe(true);
    });

    it('leaves other pages outside the workspace', () => {
        expect(isWorkspacePath('/demo/ui')).toBe(false);
        expect(isWorkspacePath('/sessionsx')).toBe(false);
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

    // A session is open, so the rail shows the shell
    const render = (flavor: AppFlavor) => act(() => root.render(
        <MemoryRouter initialEntries={['/sessions/abc']}>
            <FlavorProvider requested={flavor}>
                <SessionViewModeProvider>
                    <NavRailPages wide={true} />
                </SessionViewModeProvider>
            </FlavorProvider>
        </MemoryRouter>,
    ));
    const items = () => [...container.querySelectorAll('button, [role="separator"]')]
        .map(e => e.getAttribute('aria-label') ?? '|');

    it('lays out the pages of the sidb flavor in groups', () => {
        render(SIDB_FLAVOR);
        expect(items()).toEqual([
            'Workspace', 'Shell', 'Ingestion', 'Data Pipelines', '|',
            'Indexes', 'AI & ML', 'PostgreSQL', 'Marketplace', '|',
            'Catalog', 'Monitoring', 'Governance', 'Sharing', '|',
            'Compute', 'Admin',
        ]);
        const upcoming = SIDB_FLAVOR.railPages.flat().filter(page => page.type === 'upcoming');
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
        expect(items()).toEqual(['Workspace', 'Shell']);
    });
});
