import * as React from 'react';
import { classNames } from '@akohn/dashql-react/dom/classnames';

import * as styles from './navbar_button.module.css';

export enum HoverMode {
    Invert,
    Darken,
    Lighten,
}

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    className?: string;
    hover?: HoverMode;
    invert?: boolean;
    children?: React.ReactNode;
};

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
