import * as React from 'react';
import { Link } from 'react-router-dom';
import { clsx } from '../utils';

import styles from './button.module.css';

type ButtonProps = {
    className?: string;
    width: string;
    height: string;
    icon: string;
    disabled?: boolean;
    onClick?: () => void;
};

export const Button: React.FC<ButtonProps> = (props: ButtonProps) => (
    <div
        className={clsx(styles.button, props.className, {
            [styles.disabled]: props.disabled,
        })}
        onClick={props.onClick}
    >
        <svg width={props.width} height={props.height}>
            <use xlinkHref={`${props.icon}#sym`} />
        </svg>
    </div>
);

type LinkProps = {
    className?: string;
    width: string;
    height: string;
    icon: string;
    to: string;
};

export const LinkButton: React.FC<LinkProps> = (props: LinkProps) => (
    <Link className={clsx(styles.button, props.className)} to={props.to}>
        <svg width={props.width} height={props.height}>
            <use xlinkHref={`${props.icon}#sym`} />
        </svg>
    </Link>
);
