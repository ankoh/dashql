import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { CheckIcon, SymbolIcon, XIcon } from './symbol_icon.js';

describe('SymbolIcon', () => {
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

    function render(icon: React.ReactElement) {
        act(() => root.render(icon));
        return container.querySelector('svg')!;
    }

    it('renders a decorative 16px atlas symbol by default', () => {
        const svg = render(<CheckIcon className="check" />);

        expect(svg.getAttribute('width')).toBe('16');
        expect(svg.getAttribute('height')).toBe('16');
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.getAttribute('role')).toBeNull();
        expect(svg.classList.contains('check')).toBe(true);
        expect(svg.querySelector('use')?.getAttribute('xlink:href')).toBe('/dependencies/svg-symbols/symbols.generated.svg#check_16');
    });

    it('selects the closest natural symbol without exceeding the rendered size', () => {
        let svg = render(<XIcon size={12} />);
        expect(svg.querySelector('use')?.getAttribute('xlink:href')).toBe('/dependencies/svg-symbols/symbols.generated.svg#x_12');

        svg = render(<XIcon size={20} />);
        expect(svg.querySelector('use')?.getAttribute('xlink:href')).toBe('/dependencies/svg-symbols/symbols.generated.svg#x_16');

        svg = render(<XIcon size="medium" />);
        expect(svg.getAttribute('width')).toBe('32');
        expect(svg.querySelector('use')?.getAttribute('xlink:href')).toBe('/dependencies/svg-symbols/symbols.generated.svg#x_24');
    });

    it('forwards SVG properties and exposes explicitly labelled graphics', () => {
        const svg = render(
            <CheckIcon aria-label="Complete" id="complete" fill="red" style={{ opacity: 0.5 }} />,
        );

        expect(svg.getAttribute('aria-hidden')).toBeNull();
        expect(svg.getAttribute('aria-label')).toBe('Complete');
        expect(svg.getAttribute('role')).toBe('img');
        expect(svg.getAttribute('color')).toBe('red');
        expect(svg.getAttribute('fill')).toBe('currentColor');
        expect(svg.id).toBe('complete');
        expect(svg.style.opacity).toBe('0.5');
    });

    it('keeps empty labels decorative', () => {
        const svg = render(<CheckIcon aria-label="" />);

        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.getAttribute('role')).toBeNull();
    });

    it('caches dynamic symbol components', () => {
        const first = SymbolIcon('custom_symbol');
        const second = SymbolIcon('custom_symbol');
        expect(first).toBe(second);

        const svg = render(React.createElement(first, { size: 14 }));
        expect(svg.getAttribute('width')).toBe('14');
        expect(svg.querySelector('use')?.getAttribute('xlink:href')).toBe('/dependencies/svg-symbols/symbols.generated.svg#custom_symbol');
    });
});
