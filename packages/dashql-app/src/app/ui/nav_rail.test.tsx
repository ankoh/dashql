import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { isWorkspacePath, NavRailUpcomingPages } from './nav_rail.js';
import { FlavorProvider } from '../flavor/flavor_provider.js';
import { DASHQL_FLAVOR, SIDB_FLAVOR } from '../flavor/flavors.js';

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

describe('Nav rail upcoming pages', () => {
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

    it('shows the upcoming pages of the sidb flavor as disabled buttons', () => {
        act(() => root.render(
            <FlavorProvider requested={SIDB_FLAVOR}>
                <NavRailUpcomingPages wide={true} />
            </FlavorProvider>,
        ));
        // A separator goes in front of every group
        const items = [...container.querySelectorAll('button, [role="separator"]')]
            .map(e => e.getAttribute('aria-label') ?? '|');
        expect(items).toEqual(SIDB_FLAVOR.upcomingPages.flatMap(group => ['|', ...group.map(page => page.label)]));
        const pages = SIDB_FLAVOR.upcomingPages.flat();
        expect(pages.length).toBeGreaterThan(0);
        for (const page of pages) {
            const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${page.label}"]`)!;
            expect(button.getAttribute('aria-disabled')).toBe('true');
            expect(button.textContent).toBe(page.label);
            expect(button.querySelector('use')?.getAttribute('xlink:href')).toMatch(new RegExp(`#${page.icon}$`));
        }
    });

    it('shows no upcoming pages for DashQL', () => {
        act(() => root.render(
            <FlavorProvider requested={DASHQL_FLAVOR}>
                <NavRailUpcomingPages wide={true} />
            </FlavorProvider>,
        ));
        expect(container.querySelectorAll('button').length).toBe(0);
    });
});
