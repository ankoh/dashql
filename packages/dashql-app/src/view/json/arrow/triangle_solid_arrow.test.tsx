import * as React from 'react';
import { render } from '@testing-library/react';
import { TriangleSolidArrow } from './triangle_solid_arrow.js';

it('renders <TriangleSolidArrow /> test case', () => {
    const { container } = render(<TriangleSolidArrow data-testid="arrow" />);
    const svg = container.firstElementChild as SVGSVGElement;

    expect(svg).toBeInstanceOf(Element);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 30 30');
    expect(svg.getAttribute('fill')).toBe('var(--w-rjv-arrow-color, currentColor)');
    expect(svg.getAttribute('height')).toBe('1em');
    expect(svg.getAttribute('width')).toBe('1em');
    expect(svg.style.cursor).toBe('pointer');
    expect(svg.style.height).toBe('1em');
    expect(svg.style.width).toBe('1em');
    expect(svg.style.display).toBe('flex');
    expect(svg.style.userSelect).toBe('none');
});
