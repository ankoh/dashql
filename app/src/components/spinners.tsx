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

export function ActionStatusSpinner(props: IActionStatusSpinnerProps): JSX.Element {
    const status_code = props.status ? props.status.statusCode() : proto.action.ActionStatusCode.NONE;
    let element = <div />;
    switch (status_code) {
        case proto.action.ActionStatusCode.NONE:
        case proto.action.ActionStatusCode.RUNNING:
        case proto.action.ActionStatusCode.COMPLETED:
        case proto.action.ActionStatusCode.ERROR:
        case proto.action.ActionStatusCode.BLOCKED:
        case proto.action.ActionStatusCode.PREPARING:
            element = (
                <svg
                    className={classNames(props.className)}
                    width={props.width || '24px'}
                    height={props.height || '24px'}
                    viewBox="-8 -8 16 16"
                    fill="none"
                    stroke={props.fill || "white"}
                    strokeWidth="2"
                >
                    <g fill="none" fillRule="evenodd">
                        <circle cx="0" cy="0" r="7" opacity=".5"></circle>
                        <circle cx="0" cy="0" r="4" strokeWidth="0" fill={props.fill || "white"}></circle>
                        <circle cx="0" cy="0" r="7" strokeDasharray="12, 88" className={styles.status_spinner} />
                    </g>
                </svg>
            );
    }
    return element;
}
