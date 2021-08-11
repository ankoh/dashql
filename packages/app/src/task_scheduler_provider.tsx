// Copyright (c) 2021 The DashQL Authors

import React from 'react';
import { TaskGraphScheduler } from './task_scheduler';

type Props = {
    children: React.ReactElement;
};

const schedulerCtx = React.createContext<TaskGraphScheduler | null>(null);

export const TaskSchedulerProvider: React.FC<Props> = (props: Props) => {
    const scheduler = React.useRef<TaskGraphScheduler>(new TaskGraphScheduler());
    return <schedulerCtx.Provider value={scheduler.current}>{props.children}</schedulerCtx.Provider>;
};

export const useScheduler = (): TaskGraphScheduler => React.useContext(schedulerCtx)!;
