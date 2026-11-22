import * as React from 'react';
import { act } from '../testing/react_act.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Deferred, RenderScheduleContext } from './deferred.js';
import { Skeleton } from './skeleton.js';
import type { RenderSchedule } from '../dom/calm_frames.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('Deferred', () => {
    let container: HTMLDivElement;
    let root: Root;
    /// The schedule runs its tasks when the test says so
    let tasks: (() => void)[];
    let dropped: number;
    let schedule: RenderSchedule;
    let suspended: boolean;
    let listeners: Set<() => void>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        tasks = [];
        dropped = 0;
        suspended = false;
        listeners = new Set();
        const setSuspended = (value: boolean) => {
            suspended = value;
            for (const listener of listeners) listener();
        };
        schedule = {
            schedule: task => {
                tasks.push(task);
                return () => { dropped += 1; };
            },
            hold: vi.fn(),
            suspend: () => {
                setSuspended(true);
                return () => setSuspended(false);
            },
            suspended: () => suspended,
            subscribe: listener => {
                listeners.add(listener);
                return () => { listeners.delete(listener); };
            },
        };
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function render(content: React.ReactNode) {
        act(() => root.render(
            <RenderScheduleContext.Provider value={schedule}>
                <Deferred fallback={<Skeleton />}>{content}</Deferred>
            </RenderScheduleContext.Provider>,
        ));
    }
    const skeleton = () => container.querySelector('[data-testid="skeleton"]');

    it('shows the fallback until a calm frame and the content from then on', () => {
        render(<span data-testid="content">first</span>);
        expect(skeleton()).not.toBeNull();
        expect(container.querySelector('[data-testid="content"]')).toBeNull();
        expect(tasks).toHaveLength(1);

        act(() => tasks.shift()!());
        expect(skeleton()).toBeNull();
        expect(container.textContent).toBe('first');
        // New content renders right away, it waits only once
        render(<span data-testid="content">second</span>);
        expect(container.textContent).toBe('second');
        expect(tasks).toHaveLength(0);
    });

    it('drops its task when it unmounts before a calm frame', () => {
        render(<span>content</span>);
        expect(tasks).toHaveLength(1);
        act(() => root.render(<></>));
        expect(dropped).toBe(1);
    });

    it('shows the fallback over its mounted content while suspended and the content again in a calm frame', () => {
        const mounts = vi.fn();
        function Content() {
            React.useEffect(() => mounts(), []);
            return <span data-testid="content">chart</span>;
        }
        render(<Content />);
        act(() => tasks.shift()!());
        expect(skeleton()).toBeNull();
        expect(mounts).toHaveBeenCalledOnce();

        let resume: () => void = () => {};
        act(() => { resume = schedule.suspend(); });
        expect(skeleton()).not.toBeNull();
        // The content stays mounted below the fallback, a suspension doesn't schedule it again
        expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
        expect(tasks).toHaveLength(0);

        act(() => resume());
        expect(skeleton()).not.toBeNull();
        expect(tasks).toHaveLength(1);
        act(() => tasks.shift()!());
        expect(skeleton()).toBeNull();
        expect(container.textContent).toBe('chart');
        expect(mounts).toHaveBeenCalledOnce();
    });

    it('renders immediate content right away and shows the fallback only while suspended', () => {
        act(() => root.render(
            <RenderScheduleContext.Provider value={schedule}>
                <Deferred immediate fallback={<Skeleton />}><span>chart</span></Deferred>
            </RenderScheduleContext.Provider>,
        ));
        expect(skeleton()).toBeNull();
        expect(container.textContent).toBe('chart');
        expect(tasks).toHaveLength(0);

        let resume: () => void = () => {};
        act(() => { resume = schedule.suspend(); });
        expect(skeleton()).not.toBeNull();
        act(() => resume());
        act(() => tasks.shift()!());
        expect(skeleton()).toBeNull();
    });
});
