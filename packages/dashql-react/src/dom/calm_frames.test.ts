import { describe, expect, it, vi } from 'vitest';

import { CalmFrameSchedule, IMMEDIATE_SCHEDULE } from './calm_frames.js';

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

    it('holds the tasks while a view transition runs', async () => {
        const schedule = new CalmFrameSchedule();
        const ran: string[] = [];
        schedule.hold(150);
        schedule.schedule(() => ran.push('a'));
        await sleep(60);
        expect(ran).toEqual([]);
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

describe('IMMEDIATE_SCHEDULE', () => {
    it('runs a task right away', () => {
        const task = vi.fn();
        IMMEDIATE_SCHEDULE.schedule(task);
        expect(task).toHaveBeenCalledOnce();
    });
});
