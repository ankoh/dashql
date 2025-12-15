import * as React from 'react';

import { classNames } from '../../utils/classnames.js';

import * as styles from './status_indicator.module.css';
import { ProgressCounter } from '../../utils/progress.js';

export enum IndicatorStatus {
    None,
    Running,
    Failed,
    Succeeded,
    Blocked,
    Skip,
}

export function getStatusFromProgressCounter(counter: ProgressCounter): IndicatorStatus {
    let out = IndicatorStatus.None;
    if (counter.failed > 0) {
        out = IndicatorStatus.Failed;
    } else if (counter.succeeded > 0 && ((counter.succeeded + counter.skipped) >= (counter.total ?? 0))) {
        out = IndicatorStatus.Succeeded;
    } else if (counter.total == 0) {
        out = IndicatorStatus.Succeeded;
    } else if (counter.started > 0) {
        out = IndicatorStatus.Running;
    } else if (counter.skipped > 0) {
        out = IndicatorStatus.Skip;
    }
    return out;
}

export function combineIndicatorStatus(l: IndicatorStatus, r: IndicatorStatus): IndicatorStatus {
    if (l == r) {
        return l;
    }
    if (l == IndicatorStatus.Running || r == IndicatorStatus.Running) {
        return IndicatorStatus.Running;
    }
    if (l == IndicatorStatus.Failed || r == IndicatorStatus.Failed) {
        return IndicatorStatus.Failed;
    }
    if (l == IndicatorStatus.Blocked || r == IndicatorStatus.Blocked) {
        return IndicatorStatus.Blocked;
    }
    if (l == IndicatorStatus.Succeeded || r == IndicatorStatus.Succeeded) {
        return IndicatorStatus.Succeeded;
    }
    return IndicatorStatus.None;
}


export interface StatusIndicatorProps {
    className?: string;
    status: IndicatorStatus;
    width?: string;
    height?: string;
    fill?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = (props: StatusIndicatorProps) => {
    let element = <div />;
    switch (props.status) {
        case IndicatorStatus.Running:
            element = (
                <svg
                    className={classNames(props.className)}
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
                        <circle cx="0" cy="0" r="7" strokeDasharray="12, 88" className={styles.status_running_spinner} />
                    </g>
                </svg>
            );
            break;
        case IndicatorStatus.None:
            element = (
                <svg
                    className={classNames(props.className)}
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
        case IndicatorStatus.Failed:
            element = (
                <svg
                    className={classNames(props.className)}
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
        case IndicatorStatus.Succeeded:
            element = (
                <svg
                    className={classNames(props.className)}
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
        case IndicatorStatus.Skip:
            element = (
                <svg
                    className={classNames(props.className)}
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
                            d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm11.333-2.167a.825.825 0 0 0-1.166-1.166l-5.5 5.5a.825.825 0 0 0 1.166 1.166Z"
                        ></path>
                    </g>
                </svg>
            );
            break;
    }
    return element;
};
