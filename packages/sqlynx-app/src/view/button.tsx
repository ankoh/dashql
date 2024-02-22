import * as React from 'react';
import { Link } from 'react-router-dom';
import { classNames } from '../utils/classnames.js';

import styles from './button.module.css';

export enum HoverMode {
    Invert,
    Darken,
    Lighten,
}

type ButtonProps = {
    className?: string;
    disabled?: boolean;
    hover?: HoverMode;
    invert?: boolean;
    onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
    children?: React.ReactElement;
};

export const Button: React.FC<ButtonProps> = (props: ButtonProps) => (
    <div
        className={classNames(props.className, {
            [styles.button]: props.invert === undefined || !props.invert,
            [styles.button_inverted]: props.invert,
            [styles.disabled]: props.disabled,
            [styles.hover_invert]: props.hover === undefined || props.hover === HoverMode.Invert,
            [styles.hover_lighten]: props.hover === HoverMode.Lighten,
            [styles.hover_darken]: props.hover === HoverMode.Darken,
        })}
        onClick={props.onClick}
    >
        {props.children}
    </div>
);

type LinkProps = {
    className?: string;
    to: string;
    hover?: HoverMode;
    invert?: boolean;
    children?: React.ReactElement;
    newWindow?: boolean;
};

export const LinkButton: React.FC<LinkProps> = (props: LinkProps) => (
    <Link
        className={classNames(props.className, {
            [styles.button]: props.invert === undefined || !props.invert,
            [styles.button_inverted]: props.invert,
            [styles.hover_invert]: props.hover === undefined || props.hover === HoverMode.Invert,
            [styles.hover_lighten]: props.hover === HoverMode.Lighten,
            [styles.hover_darken]: props.hover === HoverMode.Darken,
        })}
        to={props.to}
        target={props.newWindow ? '_blank' : undefined}
    >
        {props.children}
    </Link>
);
