import * as React from 'react';
import { render } from '@testing-library/react';
import { TriangleArrow } from './triangle_arrow.js';

it('renders <TriangleArrow /> test case', () => {
    const { container } = render(<TriangleArrow data-testid="arrow" />);
    const svg = container.firstElementChild as SVGSVGElement;

    expect(svg).toBeInstanceOf(Element);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('fill')).toBe('var(--w-rjv-arrow-color, currentColor)');
    expect(svg.style.cursor).toBe('pointer');
    expect(svg.style.height).toBe('1em');
    expect(svg.style.width).toBe('1em');
    expect(svg.style.display).toBe('inline-flex');
    expect(svg.style.userSelect).toBe('none');
});
