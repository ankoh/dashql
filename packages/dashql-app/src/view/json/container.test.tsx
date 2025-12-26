import * as React from 'react';

import { userEvent } from '@testing-library/user-event';
import { render, waitFor, fireEvent } from '@testing-library/react';
import JsonView from './index.js';

const avatar = 'https://i.imgur.com/MK3eW3As.jpg';
const example = {
    avatar,
};

it('renders <JsonView /> Container test case', async () => {
    const user = userEvent.setup();
    const divref = React.createRef<HTMLDivElement>();
    const { container } = render(
        <JsonView value={example} ref={divref}>
            <JsonView.Copied />
            <JsonView.CountInfo />
        </JsonView>,
    );
    expect(container.firstElementChild).toBeInstanceOf(Element);
    fireEvent.mouseEnter(container.lastElementChild!);

    const copied = container.querySelector('.w-rjv-copied');
    expect(copied).not.toBeNull();
    expect((copied as HTMLElement).style).toHaveProperty('height', '1em');
    expect((copied as HTMLElement).style).toHaveProperty('width', '1em');
    expect((copied as HTMLElement).style).toHaveProperty('cursor', 'pointer');
    expect((copied as HTMLElement).style).toHaveProperty('vertical-align', 'middle');
    expect((copied as HTMLElement).style).toHaveProperty('margin-left', '5px');

    await React.act(async () => {
        await user.unhover(container.lastElementChild!);
    });

    const countInfo = container.querySelector('.w-rjv-object-size');
    expect(countInfo).not.toBeNull();

    await waitFor(() => {
        expect(divref.current instanceof HTMLDivElement).toBeTruthy();
    });
});
