import * as React from 'react';
import { proto } from '@dashql/core';
import classNames from 'classnames';
import styles from './spinners.module.css';

interface IRectangleWaveSpinnerProps {
    color?: string;
    active: boolean;
}

export class RectangleWaveSpinner extends React.PureComponent<
    IRectangleWaveSpinnerProps
> {
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
    status: proto.action.ActionStatus | null;
    className?: string;
    width?: string;
    height?: string;
    fill?: string;
}

export function ActionStatusSpinner(props: IActionStatusSpinnerProps) {
    const status_code = props.status ? props.status.statusCode() : proto.action.ActionStatusCode.NONE;
    switch (status_code) {
        case proto.action.ActionStatusCode.NONE:
        case proto.action.ActionStatusCode.RUNNING:
        case proto.action.ActionStatusCode.COMPLETED:
        case proto.action.ActionStatusCode.ERROR:
        case proto.action.ActionStatusCode.BLOCKED:
        case proto.action.ActionStatusCode.PREPARING:
            return (
                <svg
                    className={classNames(styles.status_spinner, props.className)}
                    width={props.width || '24px'}
                    height={props.height || '24px'}
                    viewBox="0 0 18 18"
                    fill="none"
                    stroke={props.fill || "white"}
                >
                    <g fill="none" fillRule="evenodd">
                        <g transform="translate(1 1)" strokeWidth="2">
                            <circle opacity=".5" cx="8" cy="8" r="7"></circle>
                            <circle cx="8" cy="8" r="4" strokeWidth="0" fill={props.fill || "white"}></circle>
                            <path d=" M 15 8 A 7 7 0 0 1 8 15"></path>
                        </g>
                    </g>
                </svg>
            );
    }
}
