import * as React from 'react';

import { screen, render } from '@testing-library/react';
import JsonView from '../index.js';

const avatar = 'https://i.imgur.com/MK3eW3As.jpg';
const example = {
    avatar,
};

it('renders <JsonView.CountInfo /> test case', async () => {
    const { container } = render(
        <JsonView value={example}>
            <JsonView.CountInfo data-testid="countInfo" />
        </JsonView>,
    );
    expect(container.firstElementChild).toBeInstanceOf(Element);
    const copied = screen.getByTestId('countInfo');
    expect(copied.className).toEqual('w-rjv-object-size');
    expect(copied.style).toHaveProperty('padding-left', '8px');
    expect(copied.style).toHaveProperty('font-style', 'italic');
});

it('renders <JsonView.CountInfo /> test case', async () => {
    const { container } = render(
        <JsonView value={example}>
            <JsonView.CountInfo
                data-testid="countInfo"
                render={(props) => {
                    return <span {...props}>xxx</span>;
                }}
            />
        </JsonView>,
    );
    expect(container.firstElementChild).toBeInstanceOf(Element);
    const copied = screen.getByTestId('countInfo');
    expect(copied.className).toEqual('w-rjv-object-size');
    expect(copied.style).toHaveProperty('padding-left', '8px');
    expect(copied.style).toHaveProperty('font-style', 'italic');
});

it('renders <JsonView.CountInfo /> displayObjectSize test case', async () => {
    const { container } = render(
        <JsonView value={example} displayObjectSize={false}>
            <JsonView.CountInfo data-testid="countInfo" />
        </JsonView>,
    );
    expect(container.firstElementChild).toBeInstanceOf(Element);
    // When displayObjectSize is false, countInfo should not be rendered in the DOM
    const countInfoElements = container.querySelectorAll('.w-rjv-object-size');
    expect(countInfoElements.length).toBe(0);
});
