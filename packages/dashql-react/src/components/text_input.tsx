import * as React from 'react';
import * as styles from './text_input.module.css';

import { classNames } from '../dom/classnames.js';

export enum TextInputValidationStatus {
    Success = 1,
    Warning = 2,
    Error = 3,
}

/// The frame around the field: the border, the visuals and the actions
interface TextInputFrameProps {
    className?: string;
    leadingVisual?: React.ElementType;
    /// A button before the text, stays usable while the input is disabled
    leadingAction?: React.ReactElement<React.HTMLProps<HTMLButtonElement>>;
    trailingVisual?: React.ElementType;
    trailingAction?: React.ReactElement<React.HTMLProps<HTMLButtonElement>>;
    block?: boolean;
    validationStatus?: TextInputValidationStatus;
    disabled?: boolean;
}

function TextInputFrame(props: TextInputFrameProps & { multiline?: boolean; children: React.ReactNode }): React.ReactElement {
    const { leadingVisual: LeadingVisual, trailingVisual: TrailingVisual } = props;
    return (
        <span className={classNames(styles.root, props.className, {
            [styles.root_disabled]: props.disabled,
            [styles.root_block]: props.block,
            [styles.root_multiline]: props.multiline,
            [styles.root_validation_success]: props.validationStatus == TextInputValidationStatus.Success,
            [styles.root_validation_warning]: props.validationStatus == TextInputValidationStatus.Warning,
            [styles.root_validation_error]: props.validationStatus == TextInputValidationStatus.Error,
        })}>
            {props.leadingAction && (
                <span className={styles.leading_action_container}>
                    {props.leadingAction}
                </span>
            )}
            {LeadingVisual && (
                <span className={styles.leading_visual_container}>
                    <LeadingVisual />
                </span>
            )}
            {props.children}
            {TrailingVisual && (
                <span className={styles.trailing_visual_container}>
                    <TrailingVisual />
                </span>
            )}
            {props.trailingAction && (
                <span className={styles.trailing_action_container}>
                    {props.trailingAction}
                </span>
            )}
        </span>
    );
}

interface TextInputProps extends TextInputFrameProps, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className' | 'size' | 'autoComplete'> {
    autoComplete?: boolean | string;
}

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>((props, ref): React.ReactElement => {
    const { autoComplete, block, className, disabled, leadingVisual, leadingAction, trailingAction, trailingVisual, validationStatus, ...inputProps } = props;
    return (
        <TextInputFrame {...{ block, className, disabled, leadingVisual, leadingAction, trailingAction, trailingVisual, validationStatus }}>
            <input
                {...inputProps}
                ref={ref}
                className={styles.input_container}
                disabled={disabled}
                autoComplete={typeof autoComplete === 'string' ? autoComplete : autoComplete ? 'on' : 'off'}
                autoCorrect="off"
                autoCapitalize="off"
            />
        </TextInputFrame>
    );
});

interface TextAreaProps extends TextInputFrameProps, Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'autoComplete'> {
    autoComplete?: boolean | string;
}

/// A text input of several lines, the visuals and actions stay on the first line. The lines do not wrap, `rows` sets
/// the height.
export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>((props, ref): React.ReactElement => {
    const { autoComplete, block, className, disabled, leadingVisual, leadingAction, trailingAction, trailingVisual, validationStatus, ...textAreaProps } = props;
    return (
        <TextInputFrame multiline {...{ block, className, disabled, leadingVisual, leadingAction, trailingAction, trailingVisual, validationStatus }}>
            <textarea
                wrap="off"
                {...textAreaProps}
                ref={ref}
                className={styles.input_container}
                disabled={disabled}
                autoComplete={typeof autoComplete === 'string' ? autoComplete : autoComplete ? 'on' : 'off'}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
            />
        </TextInputFrame>
    );
});
