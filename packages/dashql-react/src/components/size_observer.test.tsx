import * as React from 'react';
import { act } from '../testing/react_act.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useObservedSize, useSettledHeight } from './size_observer.js';

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
        // The end needs rendering updates of the browser. The WebKit of CI reported nothing within ten times the
        // transition, the bound is as generous as for the other waits on frames
        await vi.waitFor(() => expect(onHeight).toHaveBeenCalledTimes(2), { timeout: 10_000 });
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

describe('useObservedSize', () => {
    let container: HTMLDivElement;
    let root: Root;
    let size: { width: number; height: number } | null;

    /// The element mounts only when it is shown, its key replaces it
    function Probe(props: { shown: boolean; elementKey?: string; width: number }) {
        const ref = React.useRef<HTMLDivElement | null>(null);
        size = useObservedSize(ref);
        return props.shown ? <div key={props.elementKey} ref={ref} style={{ width: props.width, height: 20 }} /> : null;
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        size = null;
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('follows an element that mounts after the component', async () => {
        act(() => root.render(<Probe shown={false} width={100} />));
        expect(size).toBeNull();
        act(() => root.render(<Probe shown width={100} />));
        expect(size).toMatchObject({ width: 100, height: 20 });
        // The observer watches the element that mounted later
        (container.firstChild as HTMLDivElement).style.width = '140px';
        await vi.waitFor(() => expect(size).toMatchObject({ width: 140 }));
    });

    it('follows an element that replaces the observed one', async () => {
        act(() => root.render(<Probe shown elementKey="first" width={100} />));
        expect(size).toMatchObject({ width: 100 });
        act(() => root.render(<Probe shown={false} width={100} />));
        expect(size).toBeNull();
        act(() => root.render(<Probe shown elementKey="second" width={120} />));
        expect(size).toMatchObject({ width: 120 });
        (container.firstChild as HTMLDivElement).style.width = '160px';
        await vi.waitFor(() => expect(size).toMatchObject({ width: 160 }));
        // A key alone replaces the element as well
        act(() => root.render(<Probe shown elementKey="third" width={80} />));
        expect(size).toMatchObject({ width: 80 });
        (container.firstChild as HTMLDivElement).style.width = '90px';
        await vi.waitFor(() => expect(size).toMatchObject({ width: 90 }));
    });
});
