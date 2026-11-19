import * as React from 'react';
import * as styles from './button.module.css';

import { Tooltip, type TooltipDirection } from './tooltip.js';
import { classNames } from '../dom/classnames.js';

const BUTTON_VARIANT_CLASSNAME = [
    styles.button_variant_default,
    styles.button_variant_primary,
    styles.button_variant_danger,
    styles.button_variant_invisible,
    styles.button_variant_invisible,
];
const BUTTON_SIZE_CLASSNAME = [
    styles.button_size_tiny,
    styles.button_size_small,
    styles.button_size_medium,
    styles.button_size_large,
];

export enum ButtonVariant {
    Default,
    Primary,
    Danger,
    Invisible,
    Outline,
}

export enum ButtonSize {
    Tiny,
    Small,
    Medium,
    Large
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    className?: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    style?: React.CSSProperties;
    disabled?: boolean;
    inactive?: boolean;
    block?: boolean;
    leadingVisual?: React.ElementType | React.ReactElement;
    trailingVisual?: React.ElementType | React.ReactElement;
    trailingAction?: React.ReactElement<React.HTMLProps<HTMLButtonElement>>;
    children?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>((props: ButtonProps, ref) => {
    const {
        block,
        children,
        className,
        inactive,
        leadingVisual,
        size: _size,
        style,
        trailingAction,
        trailingVisual,
        type,
        variant: _variant,
        ...rest
    } = props;
    const variantStyle = BUTTON_VARIANT_CLASSNAME[props.variant ?? ButtonVariant.Default];
    const sizeStyle = BUTTON_SIZE_CLASSNAME[props.size ?? ButtonSize.Medium];
    const leadingVisualElement = React.isValidElement(leadingVisual)
        ? leadingVisual
        : leadingVisual ? React.createElement(leadingVisual) : null;
    const trailingVisualElement = React.isValidElement(trailingVisual)
        ? trailingVisual
        : trailingVisual ? React.createElement(trailingVisual) : null;
    return (
        <button
            className={classNames(styles.button, variantStyle, sizeStyle, {
                [styles.inactive]: inactive,
                [styles.block]: block,
                [styles.disabled]: props.disabled,
                [styles.no_visuals]: !leadingVisual && !trailingVisual && !trailingAction ? true : undefined,
            }, className)}
            {...rest}
            disabled={props.disabled}
            ref={ref}
            style={style}
            type={type ?? 'button'}
        >
            <span className={styles.button_content}>
                {leadingVisualElement && (
                    <span className={styles.leading_visual}>{leadingVisualElement}</span>
                )}
                {children && (
                    <span className={styles.text}>{children}</span>
                )}
                {trailingVisualElement && (
                    <span className={styles.trailing_visual}>{trailingVisualElement}</span>
                )}
            </span>
            {trailingAction && (
                <span className={styles.trailing_action}>
                    {trailingAction}
                </span>
            )}
        </button>
    );
});

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
    className?: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    inactive?: boolean;
    children?: React.ReactNode;
    description?: string;
    /// The side of the tooltip, below the button by default. A button at the bottom edge of the window, e.g. in a
    /// prompt, shows it above.
    tooltipDirection?: TooltipDirection;
    'aria-label': string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>((props: IconButtonProps, ref) => {
    const ariaLabel = props['aria-label'];
    const variantStyle = BUTTON_VARIANT_CLASSNAME[props.variant ?? ButtonVariant.Default];
    const sizeStyle = BUTTON_SIZE_CLASSNAME[props.size ?? ButtonSize.Medium];
    const {
        className,
        children,
        description,
        disabled,
        inactive,
        tooltipDirection,
        size: _size,
        variant: _variant,
        ['aria-label']: _ariaLabel,
        ...rest
    } = props;
    return (
        <Tooltip
            text={description ?? ariaLabel}
            type={description ? undefined : 'label'}
            direction={tooltipDirection}
        >
            <button
                {...rest}
                aria-label={ariaLabel}
                className={classNames(styles.button, styles.icon_button, variantStyle, sizeStyle, {
                    [styles.inactive]: inactive,
                    [styles.disabled]: disabled,
                }, className)}
                disabled={disabled}
                ref={ref}
                type={props.type ?? 'button'}
            >
                {children}
            </button>
        </Tooltip>
    );
});
