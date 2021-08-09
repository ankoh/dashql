import React from 'react';
import { useAnalyzer } from './analyzer';
import { TaskGraphScheduler } from './task_scheduler';

type Props = {
    children: React.ReactElement;
};

const schedulerCtx = React.createContext<TaskGraphScheduler | null>(null);

export const TaskSchedulerProvider: React.FC<Props> = (props: Props) => {
    const analyzer = useAnalyzer();
    const scheduler = React.useRef<TaskGraphScheduler>(new TaskGraphScheduler());
    return <schedulerCtx.Provider value={scheduler}>{props.children}</schedulerCtx.Provider>;
};

export const useScheduler = (): TaskGraphScheduler => React.useContext(schedulerCtx);
