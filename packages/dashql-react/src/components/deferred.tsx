import * as React from 'react';
import { perfMarks } from '@akohn/dashql';

import * as styles from './deferred.module.css';

import { CALM_FRAMES, type RenderSchedule } from '../dom/calm_frames.js';

/// The schedule of the heavy renders, the calm frames of the app by default. A test provides `IMMEDIATE_SCHEDULE`.
export const RenderScheduleContext = React.createContext<RenderSchedule>(CALM_FRAMES);

/// The schedule of the heavy renders, e.g. to hold them while a view transition runs
export function useRenderSchedule(): RenderSchedule {
    return React.useContext(RenderScheduleContext);
}

interface DeferredProps {
    /// Shown until a calm frame, e.g. a skeleton of the content
    fallback: React.ReactNode;
    /// The heavy content, rendered in a calm frame and from then on like any other content
    children: React.ReactNode;
    /// Render the content right away, only a suspension of the schedule shows the fallback, e.g. in the feed
    immediate?: boolean;
}

/// Renders its content in a calm frame of the schedule and its fallback until then. While the schedule is suspended,
/// e.g. while a panel is dragged, the content shows its fallback again: it stays mounted but the browser skips its
/// layout, it doesn't follow every step of the drag and lays out once in a calm frame after it.
export function Deferred(props: DeferredProps): React.ReactNode {
    const schedule = useRenderSchedule();
    const suspended = React.useSyncExternalStore(schedule.subscribe, schedule.suspended);
    // Whether the content rendered once, and whether it shows now
    const [mounted, setMounted] = React.useState(props.immediate === true);
    const [shown, setShown] = React.useState(props.immediate === true);
    // A suspension hides the content in the same render, it shows again in a calm frame
    if (suspended && shown) setShown(false);
    React.useEffect(() => {
        if (shown || suspended) return;
        // The perf mark of the wait for a calm frame
        const waitStarted = perfMarks.start();
        return schedule.schedule(() => {
            perfMarks.end('render:deferredWait', waitStarted);
            setMounted(true);
            setShown(true);
        });
    }, [schedule, shown, suspended]);
    if (!mounted) return props.fallback;
    return (
        <div className={styles.root}>
            <div className={shown ? styles.content : styles.content_hidden}>{props.children}</div>
            {!shown && <div className={styles.fallback}>{props.fallback}</div>}
        </div>
    );
}
