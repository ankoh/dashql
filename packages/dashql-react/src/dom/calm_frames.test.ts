import { describe, expect, it, vi } from 'vitest';

import { CalmFrameSchedule, IMMEDIATE_SCHEDULE, suspendWhileWidthChanges, transitionsEnd } from './calm_frames.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('CalmFrameSchedule', () => {
    it('runs one task per idle period in the order of the calls', async () => {
        const schedule = new CalmFrameSchedule();
        const ran: string[] = [];
        schedule.schedule(() => ran.push('a'));
        schedule.schedule(() => ran.push('b'));
        schedule.schedule(() => ran.push('c'));
        // Not in the task of the calls
        expect(ran).toEqual([]);
        await vi.waitFor(() => expect(ran).toEqual(['a', 'b', 'c']));
    });

    it('drops a task before it runs', async () => {
        const schedule = new CalmFrameSchedule();
        const ran: string[] = [];
        const drop = schedule.schedule(() => ran.push('dropped'));
        schedule.schedule(() => ran.push('kept'));
        drop();
        await vi.waitFor(() => expect(ran).toEqual(['kept']));
    });

    it('holds the tasks until the promises of the holds settle', async () => {
        const schedule = new CalmFrameSchedule();
        const ran: string[] = [];
        let resolve: () => void = () => {};
        let reject: () => void = () => {};
        schedule.hold(new Promise<void>(r => { resolve = r; }));
        schedule.hold(new Promise<void>((_, r) => { reject = r; }));
        schedule.schedule(() => ran.push('a'));
        resolve();
        await sleep(60);
        expect(ran).toEqual([]);
        // A rejected hold, e.g. of a cancelled transition, releases the tasks too
        reject();
        await vi.waitFor(() => expect(ran).toEqual(['a']));
    });

    it('holds the tasks while suspended and tells its listeners', async () => {
        const schedule = new CalmFrameSchedule();
        const ran: string[] = [];
        const changes: boolean[] = [];
        schedule.subscribe(() => changes.push(schedule.suspended()));
        const resumeOuter = schedule.suspend();
        const resumeInner = schedule.suspend();
        schedule.schedule(() => ran.push('a'));
        resumeInner();
        await sleep(60);
        expect(ran).toEqual([]);
        expect(schedule.suspended()).toBe(true);
        resumeOuter();
        // A second call of a resume does nothing
        resumeOuter();
        expect(changes).toEqual([true, false]);
        await vi.waitFor(() => expect(ran).toEqual(['a']));
    });

    it('runs a function scheduled twice twice', async () => {
        const schedule = new CalmFrameSchedule();
        const task = vi.fn();
        schedule.schedule(task);
        schedule.schedule(task);
        await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(2));
    });
});

describe('suspendWhileWidthChanges', () => {
    it('suspends while the width changes and resumes once it stays the same', async () => {
        const schedule = new CalmFrameSchedule();
        const view = Object.assign(new EventTarget(), { innerWidth: 1000 });
        const stop = suspendWhileWidthChanges(schedule, view);
        try {
            // A change of the height only, e.g. of the keyboard of a phone, keeps the renders going
            view.dispatchEvent(new Event('resize'));
            expect(schedule.suspended()).toBe(false);
            view.innerWidth = 900;
            view.dispatchEvent(new Event('resize'));
            expect(schedule.suspended()).toBe(true);
            await sleep(120);
            // Another step of the drag waits again
            view.innerWidth = 800;
            view.dispatchEvent(new Event('resize'));
            await sleep(120);
            expect(schedule.suspended()).toBe(true);
            await vi.waitFor(() => expect(schedule.suspended()).toBe(false));
        } finally {
            stop();
        }
    });

    it('resumes when it stops listening', () => {
        const schedule = new CalmFrameSchedule();
        const view = Object.assign(new EventTarget(), { innerWidth: 1000 });
        const stop = suspendWhileWidthChanges(schedule, view);
        view.innerWidth = 900;
        view.dispatchEvent(new Event('resize'));
        stop();
        expect(schedule.suspended()).toBe(false);
        view.innerWidth = 800;
        view.dispatchEvent(new Event('resize'));
        expect(schedule.suspended()).toBe(false);
    });
});

describe('transitionsEnd', () => {
    it('settles when the transitions of the element and below it end', async () => {
        const parent = document.createElement('div');
        const child = document.createElement('div');
        parent.appendChild(child);
        document.body.appendChild(parent);
        try {
            child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 80 });
            // An endless animation is not waited for
            parent.animate([{ opacity: 1 }, { opacity: 0.5 }], { duration: 1000, iterations: Infinity });
            let ended = false;
            const end = transitionsEnd(parent).then(() => { ended = true; });
            await sleep(20);
            expect(ended).toBe(false);
            await end;
            expect(child.getAnimations()).toEqual([]);
        } finally {
            parent.remove();
        }
    });

    it('settles when a transition is cancelled', async () => {
        const element = document.createElement('div');
        document.body.appendChild(element);
        try {
            const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 60_000 });
            const end = transitionsEnd(element);
            animation.cancel();
            await end;
        } finally {
            element.remove();
        }
    });

    it('settles right away without an element', async () => {
        await transitionsEnd(null);
    });
});

describe('IMMEDIATE_SCHEDULE', () => {
    it('runs a task right away', () => {
        const task = vi.fn();
        IMMEDIATE_SCHEDULE.schedule(task);
        expect(task).toHaveBeenCalledOnce();
    });
});
