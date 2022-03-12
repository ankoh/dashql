import * as React from 'react';
import * as proto from '@dashql/proto';
import * as rd from '@duckdb/react-duckdb';
import { clsx } from '../utils';

import styles from './status.module.css';

interface IStatusIndicatorProps {
    status: rd.ResolvableStatus | null;
    className?: string;
    width?: string;
    height?: string;
    fill?: string;
}

export const StatusIndicator: React.FC<IStatusIndicatorProps> = (props: IStatusIndicatorProps) => {
    const status_code = props.status ? props.status : rd.ResolvableStatus.NONE;
    let element = <div />;
    switch (status_code) {
        case rd.ResolvableStatus.RUNNING:
            element = (
                <svg
                    className={clsx(props.className)}
                    width={props.width || '24px'}
                    height={props.height || '24px'}
                    viewBox="-8 -8 16 16"
                    fill="none"
                    stroke={props.fill || 'white'}
                    strokeWidth="2"
                >
                    <g fill="none" fillRule="evenodd">
                        <circle cx="0" cy="0" r="7" opacity=".5"></circle>
                        <circle cx="0" cy="0" r="4" strokeWidth="0" fill={props.fill || 'white'}></circle>
                        <circle cx="0" cy="0" r="7" strokeDasharray="12, 88" className={styles.status_spinner} />
                    </g>
                </svg>
            );
            break;
        case rd.ResolvableStatus.NONE:
            element = (
                <svg
                    className={clsx(props.className)}
                    width={props.width || '24px'}
                    height={props.height || '24px'}
                    viewBox="-8 -8 16 16"
                    fill="none"
                    stroke={props.fill || 'white'}
                    strokeWidth="2"
                >
                    <g fill="none" fillRule="evenodd">
                        <circle cx="0" cy="0" r="4" opacity=".5" strokeWidth="0" fill={props.fill || 'white'}></circle>
                    </g>
                </svg>
            );
            break;
        case rd.ResolvableStatus.FAILED:
            element = (
                <svg
                    className={clsx(props.className)}
                    width={props.width || '24px'}
                    height={props.height || '24px'}
                    viewBox="0 0 16 16"
                    fill="none"
                    strokeWidth="2"
                >
                    <g fill="none" fillRule="evenodd">
                        <path
                            fill={props.fill || 'white'}
                            fillRule="evenodd"
                            d="M2.343 13.657A8 8 0 1113.657 2.343 8 8 0 012.343 13.657zM6.03 4.97a.75.75 0 00-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 101.06 1.06L8 9.06l1.97 1.97a.75.75 0 101.06-1.06L9.06 8l1.97-1.97a.75.75 0 10-1.06-1.06L8 6.94 6.03 4.97z"
                        ></path>
                    </g>
                </svg>
            );
            break;
        case rd.ResolvableStatus.COMPLETED:
            element = (
                <svg
                    className={clsx(props.className)}
                    width={props.width || '24px'}
                    height={props.height || '24px'}
                    viewBox="0 0 16 16"
                    fill="none"
                    strokeWidth="2"
                >
                    <g fill="none" fillRule="evenodd">
                        <path
                            fill={props.fill || 'white'}
                            fillRule="evenodd"
                            d="M8 16A8 8 0 108 0a8 8 0 000 16zm3.78-9.72a.75.75 0 00-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 00-1.06 1.06l2 2a.75.75 0 001.06 0l4.5-4.5z"
                        ></path>
                    </g>
                </svg>
            );
            break;
    }
    return element;
};

interface ITaskStatusIndicatorProps {
    status: proto.task.TaskStatusCode | null;
    className?: string;
    width?: string;
    height?: string;
    fill?: string;
}

export const TaskStatusIndicator: React.FC<ITaskStatusIndicatorProps> = (props: ITaskStatusIndicatorProps) => {
    let mappedStatus = rd.ResolvableStatus.NONE;
    switch (props.status) {
        case proto.task.TaskStatusCode.PENDING:
            mappedStatus = rd.ResolvableStatus.NONE;
            break;
        case proto.task.TaskStatusCode.COMPLETED:
            mappedStatus = rd.ResolvableStatus.COMPLETED;
            break;
        case proto.task.TaskStatusCode.BLOCKED:
            mappedStatus = rd.ResolvableStatus.RUNNING;
            break;
        case proto.task.TaskStatusCode.FAILED:
            mappedStatus = rd.ResolvableStatus.FAILED;
            break;
        case proto.task.TaskStatusCode.RUNNING:
            mappedStatus = rd.ResolvableStatus.RUNNING;
            break;
    }
    const mappedProps: IStatusIndicatorProps = {
        ...props,
        status: mappedStatus,
    };
    return <StatusIndicator {...mappedProps} />;
};
