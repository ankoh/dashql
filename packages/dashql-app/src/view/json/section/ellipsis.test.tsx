import * as React from 'react';

import { userEvent } from '@testing-library/user-event';
import { screen, render, waitFor } from '@testing-library/react';
import JsonView from '../index.js';
import { Ellipsis } from './ellipsis.js';

const avatar = 'https://i.imgur.com/MK3eW3As.jpg';
const example = {
    avatar,
};

it('renders <JsonView.Ellipsis /> test case', async () => {
    const user = userEvent.setup();
    const { container } = render(
        <JsonView value={example}>
            <Ellipsis
                as="span"
                data-testid="ellipsis"
                render={(props) => {
                    expect(props.children).toEqual('...');
                    expect(props.style).toHaveProperty('color', 'var(--w-rjv-ellipsis-color, #cb4b16)');
                    return <span {...props} />;
                }}
            />
        </JsonView>,
    );
    expect(container.firstElementChild).toBeInstanceOf(Element);
    await React.act(async () => {
        await user.click(container.lastElementChild?.firstElementChild!);
        await waitFor(() => {
            const ellipsis = screen.getByTestId('ellipsis');
            expect(ellipsis.className).toEqual('w-rjv-ellipsis');
            expect(ellipsis.style).toHaveProperty('cursor', 'pointer');
            expect(ellipsis.style).toHaveProperty('user-select', 'none');
            expect(ellipsis.innerHTML).toEqual('...');
        });
    });
});

it('renders <JsonView.Ellipsis /> children test case', async () => {
    const user = userEvent.setup();
    const { container } = render(
        <JsonView value={example}>
            <Ellipsis as="span" data-testid="ellipsis">
                xxx
            </Ellipsis>
        </JsonView>,
    );
    expect(container.firstElementChild).toBeInstanceOf(Element);
    await React.act(async () => {
        await user.click(container.lastElementChild?.firstElementChild!);
    });
    await waitFor(() => {
        const ellipsis = screen.getByTestId('ellipsis');
        expect(ellipsis.innerHTML).toEqual('xxx');
    });
});
