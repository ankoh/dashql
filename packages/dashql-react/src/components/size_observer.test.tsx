import * as React from 'react';
import { act } from '../testing/react_act.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettledHeight } from './size_observer.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/// The time of the transition of the height in the test, long enough for several frames
const TRANSITION_MS = 150;

describe('useSettledHeight', () => {
    let container: HTMLDivElement;
    let root: Root;
    let element: HTMLDivElement | null;
    let renders: number;

    function Probe(props: { onHeight: (height: number) => void }) {
        renders += 1;
        const [target, setTarget] = React.useState<HTMLDivElement | null>(null);
        useSettledHeight(target, props.onHeight);
        return <div ref={node => { element = node; setTarget(node); }} style={{ height: 40, transition: `height ${TRANSITION_MS}ms linear` }} />;
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        element = null;
        renders = 0;
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('reports the height at the end of a transition once, without a render', async () => {
        const onHeight = vi.fn();
        act(() => root.render(<Probe onHeight={onHeight} />));
        expect(onHeight.mock.calls).toEqual([[40]]);
        const rendersBefore = renders;

        element!.style.height = '100px';
        await vi.waitFor(() => expect(onHeight).toHaveBeenCalledTimes(2), { timeout: TRANSITION_MS * 10 });
        // The frames of the transition reported nothing in between
        expect(onHeight.mock.calls).toEqual([[40], [100]]);
        expect(renders).toBe(rendersBefore);
    });

    it('reports a change without a transition right away', async () => {
        const onHeight = vi.fn();
        act(() => root.render(<Probe onHeight={onHeight} />));
        element!.style.transition = 'none';
        element!.style.height = '64px';
        await vi.waitFor(() => expect(onHeight.mock.calls).toEqual([[40], [64]]));
    });
});
