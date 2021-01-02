import * as React from 'react';
import { proto } from '@dashql/core';
import classNames from 'classnames';
import styles from './spinners.module.css';

interface IRectangleWaveSpinnerProps {
    color?: string;
    active: boolean;
}

export class RectangleWaveSpinner extends React.PureComponent<IRectangleWaveSpinnerProps> {
    public render() {
        const s = {
            backgroundColor: this.props.color || 'white',
        };
        return (
            <div className={styles.rw}>
                <div
                    className={classNames(styles.rw_rect_1, {
                        [styles.rw_rect_active]: this.props.active,
                    })}
                    style={s}
                />
                <div
                    className={classNames(styles.rw_rect_2, {
                        [styles.rw_rect_active]: this.props.active,
                    })}
                    style={s}
                />
                <div
                    className={classNames(styles.rw_rect_3, {
                        [styles.rw_rect_active]: this.props.active,
                    })}
                    style={s}
                />
                <div
                    className={classNames(styles.rw_rect_4, {
                        [styles.rw_rect_active]: this.props.active,
                    })}
                    style={s}
                />
                <div
                    className={classNames(styles.rw_rect_5, {
                        [styles.rw_rect_active]: this.props.active,
                    })}
                    style={s}
                />
            </div>
        );
    }
}

interface IActionStatusSpinnerProps {
    status: proto.action.ActionStatusCode | null;
    className?: string;
    width?: string;
    height?: string;
    fill?: string;
}

export function ActionStatusSpinner(props: IActionStatusSpinnerProps): JSX.Element {
    const status_code = props.status ? props.status : proto.action.ActionStatusCode.NONE;
    let element = <div />;
    switch (status_code) {
        case proto.action.ActionStatusCode.RUNNING:
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
                        <circle cx="0" cy="0" r="7" strokeDasharray="12, 88" className={styles.status_spinner} />
                    </g>
                </svg>
            );
            break;
        case proto.action.ActionStatusCode.NONE:
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
        case proto.action.ActionStatusCode.FAILED:
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
                            fill-rule="evenodd"
                            d="M2.343 13.657A8 8 0 1113.657 2.343 8 8 0 012.343 13.657zM6.03 4.97a.75.75 0 00-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 101.06 1.06L8 9.06l1.97 1.97a.75.75 0 101.06-1.06L9.06 8l1.97-1.97a.75.75 0 10-1.06-1.06L8 6.94 6.03 4.97z"
                        ></path>
                    </g>
                </svg>
            );
            break;
        case proto.action.ActionStatusCode.BLOCKED:
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
                            fill-rule="evenodd"
                            d="M1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0zM8 0a8 8 0 100 16A8 8 0 008 0zm3.28 5.78a.75.75 0 00-1.06-1.06l-5.5 5.5a.75.75 0 101.06 1.06l5.5-5.5z"
                        ></path>
                    </g>
                </svg>
            );
            break;
        case proto.action.ActionStatusCode.COMPLETED:
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
                            fill-rule="evenodd"
                            d="M8 16A8 8 0 108 0a8 8 0 000 16zm3.78-9.72a.75.75 0 00-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 00-1.06 1.06l2 2a.75.75 0 001.06 0l4.5-4.5z"
                        ></path>
                    </g>
                </svg>
            );
            break;
    }
    return element;
}
