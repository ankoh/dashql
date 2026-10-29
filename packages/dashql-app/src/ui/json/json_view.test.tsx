import * as React from 'react';

import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';

import { JsonView } from './json_view.js';

describe('JsonView array pagination', () => {
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

    it('renders large arrays incrementally', () => {
        const value = Array.from({ length: 250 }, (_, index) => index);
        act(() => root.render(<JsonView value={value} arrayPageSize={100} />));

        const loadMore = () => container.querySelector<HTMLButtonElement>('[data-testid="json-array-load-more"]');
        expect(loadMore()).not.toBeNull();
        expect(container.textContent).not.toContain('249');

        act(() => loadMore()!.click());
        expect(container.textContent).toContain('199');
        expect(container.textContent).not.toContain('249');
    });

    it('paginates nested arrays until all items are shown', () => {
        const value = { embedding: Array.from({ length: 250 }, (_, index) => index) };
        act(() => root.render(<JsonView value={value} arrayPageSize={100} />));

        const loadMore = () => container.querySelector<HTMLButtonElement>('[data-testid="json-array-load-more"]');
        expect(loadMore()).not.toBeNull();
        expect(container.textContent).not.toContain('249');

        act(() => loadMore()!.click());
        act(() => loadMore()!.click());
        expect(container.textContent).toContain('249');
        expect(loadMore()).toBeNull();
    });

    it('opts out of enclosing Electron drag regions', () => {
        act(() => root.render(<JsonView value={{ nested: true }} />));

        expect(container.firstElementChild?.getAttribute('data-electron-drag-region')).toBe('false');
    });

    it('collapses nested values below a numeric depth', () => {
        const value = { a: { b: { c: { d: 'deep' } } } };
        act(() => root.render(<JsonView value={value} collapsed={2} />));

        expect(container.textContent).toContain('c');
        expect(container.textContent).not.toContain('deep');
        const collapsedButtons = container.querySelectorAll('button[aria-expanded="false"]');
        expect(collapsedButtons.length).toBe(1);

        act(() => (collapsedButtons[0] as HTMLButtonElement).click());
        expect(container.textContent).toContain('deep');
    });

    it('shows the copy button of hovered values only', () => {
        act(() => root.render(<JsonView value={{ a: 1, b: 2 }} />));
        const copyButtons = '[data-testid="json-copy-value"]';
        expect(container.querySelectorAll(copyButtons).length).toBe(0);

        const [lineA, lineB] = Array.from(container.querySelectorAll('[data-testid="json-entry-line"]'));
        expect(lineA).toBeDefined();
        expect(lineB).toBeDefined();
        act(() => lineA.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
        expect(lineA.querySelector(copyButtons)).not.toBeNull();
        expect(lineB.querySelector(copyButtons)).toBeNull();

        act(() => lineA.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
        expect(container.querySelectorAll(copyButtons).length).toBe(0);
    });
});

describe('JsonView explorer variant', () => {
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

    it('renders values without the JSON syntax', () => {
        const value = { message: 'hello', tags: ['a', 'b'], context: null, empty: '' };
        act(() => root.render(<JsonView value={value} variant="explorer" />));

        const text = container.textContent ?? '';
        expect(text).toContain('message');
        expect(text).toContain('hello');
        expect(text).toContain('2 items');
        expect(text).toContain('null');
        expect(text).toContain('empty');
        for (const symbol of ['{', '}', '[', ']', '"', ':']) {
            expect(text).not.toContain(symbol);
        }
    });

    it('toggles nested values when clicking their row', () => {
        const value = { nested: { inner: 'deep' } };
        act(() => root.render(<JsonView value={value} variant="explorer" collapsed={0} />));
        expect(container.textContent).not.toContain('deep');

        const button = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!;
        act(() => (button.parentElement as HTMLElement).click());
        expect(container.textContent).toContain('deep');

        act(() => button.click());
        expect(container.textContent).not.toContain('deep');
    });
});
