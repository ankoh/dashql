import * as React from 'react';
import * as styles from './button.module.css';

import { Tooltip } from './tooltip.js';
import { classNames } from '../../utils/classnames.js';

const BUTTON_VARIANT_CLASSNAME = [
    styles.button_variant_default,
    styles.button_variant_primary,
    styles.button_variant_danger,
    styles.button_variant_invisible,
    styles.button_variant_invisible,
];
const BUTTON_SIZE_CLASSNAME = [
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

export function mapButtonVariant(variant: ButtonVariant) {
    switch (variant) {
        case ButtonVariant.Default: return 'default';
        case ButtonVariant.Primary: return 'primary';
        case ButtonVariant.Danger: return 'danger';
        case ButtonVariant.Invisible: return 'invisible';
        case ButtonVariant.Outline: return 'outline';
    }
}

export enum ButtonSize {
    Small,
    Medium,
    Large
}

export function mapButtonSize(size: ButtonSize) {
    switch (size) {
        case ButtonSize.Small: return 'small';
        case ButtonSize.Medium: return 'medium';
        case ButtonSize.Large: return 'large';
    }
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    className?: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    style?: React.CSSProperties;
    disabled?: boolean;
    inactive?: boolean;
    block?: boolean;
    leadingVisual?: React.ElementType;
    trailingVisual?: React.ElementType;
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
    const LeadingVisual = leadingVisual;
    const TrailingVisual = trailingVisual;
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
                {LeadingVisual && (
                    <span className={styles.leading_visual}><LeadingVisual /></span>
                )}
                {children && (
                    <span className={styles.text}>{children}</span>
                )}
                {TrailingVisual && (
                    <span className={styles.trailing_visual}><TrailingVisual /></span>
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
        size: _size,
        variant: _variant,
        ['aria-label']: _ariaLabel,
        ...rest
    } = props;
    return (
        <Tooltip
            text={description ?? ariaLabel}
            type={description ? undefined : 'label'}
        >
            <button
                {...rest}
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
