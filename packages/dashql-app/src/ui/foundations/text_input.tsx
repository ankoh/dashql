import * as React from 'react';
import * as styles from './text_input.module.css';

import { classNames } from '../../utils/classnames.js';

export enum TextInputValidationStatus {
    Success = 1,
    Warning = 2,
    Error = 3,
}

interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className' | 'size' | 'autoComplete'> {
    className?: string;
    leadingVisual?: React.ElementType;
    trailingVisual?: React.ElementType;
    trailingAction?: React.ReactElement<React.HTMLProps<HTMLButtonElement>>;
    block?: boolean;
    validationStatus?: TextInputValidationStatus;
    autoComplete?: boolean | string;
}

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>((props, ref): React.ReactElement => {
    const {
        autoComplete,
        block,
        className,
        disabled,
        leadingVisual: LeadingVisual,
        trailingAction,
        trailingVisual: TrailingVisual,
        validationStatus,
        ...inputProps
    } = props;
    return (
        <span className={classNames(styles.root, className, {
            [styles.root_disabled]: disabled,
            [styles.root_block]: block,
            [styles.root_validation_success]: validationStatus == TextInputValidationStatus.Success,
            [styles.root_validation_warning]: validationStatus == TextInputValidationStatus.Warning,
            [styles.root_validation_error]: validationStatus == TextInputValidationStatus.Error,
        })}>
            {LeadingVisual && (
                <span className={styles.leading_visual_container}>
                    <LeadingVisual />
                </span>
            )}
            <input
                {...inputProps}
                ref={ref}
                className={styles.input_container}
                disabled={disabled}
                autoComplete={typeof autoComplete === 'string' ? autoComplete : autoComplete ? 'on' : 'off'}
                autoCorrect="off"
                autoCapitalize="off"
            />
            {TrailingVisual && (
                <span className={styles.trailing_visual_container}>
                    <TrailingVisual />
                </span>
            )}
            {trailingAction && (
                <span className={styles.trailing_action_container}>
                    {trailingAction}
                </span>
            )}
        </span>
    );
});
