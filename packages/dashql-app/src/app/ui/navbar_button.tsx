import * as React from 'react';
import { Link } from 'react-router-dom';
import { classNames } from '../../utils/classnames.js';

import * as styles from './navbar_button.module.css';
import { RouteContext } from '../router/router.js';

export enum HoverMode {
    Invert,
    Darken,
    Lighten,
}

type LinkProps = {
    'aria-label'?: string;
    className?: string;
    to: string;
    hover?: HoverMode;
    invert?: boolean;
    children?: React.ReactElement;
    newWindow?: boolean;
    state: RouteContext;
    title?: string;
};

export const NavBarLink: React.FC<LinkProps> = (props: LinkProps) => (
    <Link
        aria-label={props['aria-label']}
        className={classNames(props.className, {
            [styles.button]: props.invert === undefined || !props.invert,
            [styles.button_inverted]: props.invert,
            [styles.hover_invert]: props.hover === undefined || props.hover === HoverMode.Invert,
            [styles.hover_lighten]: props.hover === HoverMode.Lighten,
            [styles.hover_darken]: props.hover === HoverMode.Darken,
        })}
        to={props.to}
        target={props.newWindow ? '_blank' : undefined}
        state={props.state}
        title={props.title}
    >
        {props.children}
    </Link>
);

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    className?: string;
    hover?: HoverMode;
    invert?: boolean;
    children?: React.ReactNode;
};

export const NavBarButton: React.FC<ButtonProps> = ({ className, hover, invert, children, type, ...props }) => (
    <button
        {...props}
        className={classNames(className, {
            [styles.button]: invert === undefined || !invert,
            [styles.button_inverted]: invert,
            [styles.hover_invert]: hover === undefined || hover === HoverMode.Invert,
            [styles.hover_lighten]: hover === HoverMode.Lighten,
            [styles.hover_darken]: hover === HoverMode.Darken,
        })}
        type={type ?? 'button'}
    >
        {children}
    </button>
);

export const NavBarButtonWithRef = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, hover, invert, children, type, ...props }, ref) => (
    <button
        {...props}
        ref={ref}
        className={classNames(className, {
            [styles.button]: invert === undefined || !invert,
            [styles.button_inverted]: invert,
            [styles.hover_invert]: hover === undefined || hover === HoverMode.Invert,
            [styles.hover_lighten]: hover === HoverMode.Lighten,
            [styles.hover_darken]: hover === HoverMode.Darken,
        })}
        type={type ?? 'button'}
    >
        {children}
    </button>
));
