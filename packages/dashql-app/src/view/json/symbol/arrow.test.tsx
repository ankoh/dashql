import * as React from 'react';
import { screen, render, waitFor } from '@testing-library/react';
import JsonView from '../index.js';
import { TriangleSolidArrow } from '../arrow/triangle_solid_arrow.js';

it('renders <JsonView.Arrow /> test case', async () => {
    const demo = {
        value: '123',
    };
    const { container } = render(
        <JsonView value={demo}>
            <JsonView.Arrow>
                <TriangleSolidArrow data-testid="arrow" />
            </JsonView.Arrow>
        </JsonView>,
    );
    expect(container.firstElementChild).toBeInstanceOf(Element);
    await waitFor(() => {
        const arrow = screen.getByTestId('arrow') as unknown as SVGSVGElement;
        expect(arrow.tagName).toBe('svg');
    });
});

it('renders <JsonView.Arrow /> test case', async () => {
    const demo = {
        value: '123',
    };
    const { container } = render(
        <JsonView value={demo}>
            <JsonView.Arrow
                render={() => {
                    return <span data-testid="arrow">x</span>;
                }}
            />
        </JsonView>,
    );
    expect(container.firstElementChild).toBeInstanceOf(Element);
    await waitFor(() => {
        const arrow = screen.getByTestId('arrow');
        expect(arrow.tagName).toBe('SPAN');
        expect(arrow.innerHTML).toBe('x');
    });
});
