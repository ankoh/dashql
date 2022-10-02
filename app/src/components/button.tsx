import * as React from 'react';
import { Link } from 'react-router-dom';
import cn from 'classnames';

import styles from './button.module.css';

type ButtonProps = {
    className?: string;
    width: string;
    height: string;
    icon: string;
    disabled?: boolean;
    nohover?: boolean;
    onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
};

export const Button: React.FC<ButtonProps> = (props: ButtonProps) => (
    <div
        className={cn(styles.button, props.className, {
            [styles.disabled]: props.disabled,
            [styles.nohover]: props.nohover,
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
    <Link className={cn(styles.button, props.className)} to={props.to}>
        <svg width={props.width} height={props.height}>
            <use xlinkHref={`${props.icon}#sym`} />
        </svg>
    </Link>
);
