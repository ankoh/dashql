import * as React from 'react';

import { render } from '@testing-library/react';
import { JsonView } from './json_view.js';

const avatar = 'https://i.imgur.com/MK3eW3As.jpg';
const longArray = new Array(1000).fill(1);
const example = {
    avatar,
    string: 'Lorem ipsum dolor sit amet',
    integer: 42,
    float: 114.514,
    // @ts-ignore
    bigint: 10086n,
    null: null,
    undefined,
    timer: 0,
    date: new Date('Tue Sep 13 2022 14:07:44 GMT-0500 (Central Daylight Time)'),
    array: [19, 100.86, 'test', NaN, Infinity],
    nestedArray: [
        [1, 2],
        [3, 4],
    ],
    object: {
        'first-child': true,
        'second-child': false,
        'last-child': null,
    },
    longArray,
    string_number: '1234',
};

it('renders <JsonView /> test case', () => {
    const { container } = render(<JsonView value={example} />);
    const rootElement = container.firstElementChild as HTMLElement;

    expect(rootElement).toBeInstanceOf(Element);
    expect(rootElement.tagName.toLowerCase()).toBe('div');
    expect(rootElement.style.backgroundColor).toBe('var(--w-rjv-background-color, #00000000)');
    expect(rootElement.style.lineHeight).toBe('1.4');
    expect(rootElement.style.fontSize).toBe('13px');
    expect(rootElement.style.fontFamily).toBe('var(--w-rjv-font-family, Menlo, monospace)');
    expect(rootElement.style.color).toBe('var(--w-rjv-color, #002b36)');
});

it('renders <JsonView objectSortKeys /> test case', () => {
    const { container } = render(
        <JsonView value={{ b: 1, a: 2 }} objectSortKeys />
    );
    const keynames = container.querySelectorAll('.w-rjv-object-key');
    expect(keynames[0].innerHTML).toEqual('a');
});

it('renders <JsonView objectSortKeys={false} /> test case', () => {
    const { container } = render(
        <JsonView value={{ b: 1, a: 2 }} objectSortKeys={false} />
    );
    const keynames = container.querySelectorAll('.w-rjv-object-key');
    expect(keynames[0].innerHTML).toEqual('b');
});

it('renders <JsonView objectSortKeys={() => {}} /> test case', () => {
    const { container } = render(
        <JsonView
            value={{ bool: 1, a: 2 }}
            objectSortKeys={(a, b, valA, valB) => {
                expect(a).toEqual('a');
                expect(b).toEqual('bool');
                expect(valA).toEqual(2);
                expect(valB).toEqual(1);
                return a.localeCompare(b);
            }}
        />
    );
    const keynames = container.querySelectorAll('.w-rjv-object-key');
    expect(keynames[0].innerHTML).toEqual('a');
});
