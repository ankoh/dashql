import * as React from 'react';
import * as model from '../model';
import classNames from 'classnames';

import styles from './status_indicator.module.css';

interface IStatusIndicatorProps {
    status: model.ResolvableStatus | null;
    className?: string;
    width?: string;
    height?: string;
    fill?: string;
}

export const StatusIndicator: React.FC<IStatusIndicatorProps> = (props: IStatusIndicatorProps) => {
    const status_code = props.status ? props.status : model.ResolvableStatus.NONE;
    let element = <div />;
    switch (status_code) {
        case model.ResolvableStatus.RUNNING:
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
        case model.ResolvableStatus.NONE:
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
        case model.ResolvableStatus.FAILED:
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
        case model.ResolvableStatus.COMPLETED:
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
    }
    return element;
};
