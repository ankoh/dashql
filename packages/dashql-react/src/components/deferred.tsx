import * as React from 'react';

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
}

/// Renders its content in a calm frame of the schedule and its fallback until then
export function Deferred(props: DeferredProps): React.ReactNode {
    const schedule = useRenderSchedule();
    const [released, setReleased] = React.useState(false);
    React.useEffect(() => {
        if (released) return;
        return schedule.schedule(() => setReleased(true));
    }, [schedule, released]);
    return released ? props.children : props.fallback;
}
