import * as React from 'react';
import * as styles from './segmented_control.module.css';
import { classNames } from '../../utils/classnames';
import { Tooltip } from './tooltip';

// ==================== Types ====================

export enum SegmentedControlSize {
    Small,
    Medium,
}

export interface SegmentedControlProps {
    'aria-label'?: string;
    'aria-labelledby'?: string;
    'aria-describedby'?: string;
    /** Whether the control fills the width of its parent */
    fullWidth?: boolean;
    /** The handler that gets called when a segment is selected */
    onChange?: (selectedIndex: number) => void;
    /** The size of the buttons */
    size?: SegmentedControlSize;
    className?: string;
    children?: React.ReactNode;
}

export interface SegmentedControlButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** The visible label rendered in the button */
    children: string;
    /** Whether the segment is selected (for controlled components) */
    selected?: boolean;
    /** Whether the segment is selected initially (for uncontrolled components) */
    defaultSelected?: boolean;
    /** The leading visual icon */
    leadingVisual?: React.ElementType;
    /** Optional counter to display */
    count?: number | string;
}

export interface SegmentedControlIconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
    'aria-label': string;
    /** The icon element */
    icon: React.ElementType | React.ReactElement;
    /** Whether the segment is selected (for controlled components) */
    selected?: boolean;
    /** Whether the segment is selected initially (for uncontrolled components) */
    defaultSelected?: boolean;
    /** Supplementary description for tooltip */
    description?: string;
}

// ==================== Button Component ====================

const SegmentedControlButton: React.FC<SegmentedControlButtonProps> = ({
    children,
    leadingVisual: LeadingVisual,
    selected,
    defaultSelected: _defaultSelected,
    count,
    className,
    disabled,
    ...props
}) => {
    return (
        <li className={classNames(styles.item, { [styles.selected]: selected })} data-selected={selected ? '' : undefined}>
            <button
                className={classNames(styles.button, className)}
                type="button"
                aria-current={selected}
                aria-disabled={disabled || undefined}
                disabled={disabled}
                {...props}
            >
                <span className={styles.content}>
                    {LeadingVisual && (
                        <span className={styles.leading_visual}>
                            <LeadingVisual />
                        </span>
                    )}
                    <span className={styles.text} data-text={children}>
                        {children}
                    </span>
                    {count !== undefined && (
                        <span className={styles.counter}>{count}</span>
                    )}
                </span>
            </button>
        </li>
    );
};

// ==================== IconButton Component ====================

const SegmentedControlIconButton: React.FC<SegmentedControlIconButtonProps> = ({
    'aria-label': ariaLabel,
    icon: Icon,
    selected,
    defaultSelected: _defaultSelected,
    description,
    className,
    disabled,
    ...props
}) => {
    return (
        <li className={classNames(styles.item, styles.icon_item, { [styles.selected]: selected })} data-selected={selected ? '' : undefined}>
            <Tooltip
                text={description ?? ariaLabel}
                type={description ? undefined : 'label'}
            >
                <button
                    className={classNames(styles.button, styles.icon_button, className)}
                    type="button"
                    aria-current={selected}
                    aria-label={description ? ariaLabel : undefined}
                    aria-disabled={disabled || undefined}
                    disabled={disabled}
                    {...props}
                >
                    <span className={styles.content}>
                        {React.isValidElement(Icon) ? Icon : <Icon />}
                    </span>
                </button>
            </Tooltip>
        </li>
    );
};

// ==================== Root Component ====================

const Root: React.FC<SegmentedControlProps> = ({
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledby,
    'aria-describedby': ariaDescribedby,
    children,
    fullWidth,
    onChange,
    size,
    className,
}) => {
    const isUncontrolled = onChange === undefined ||
        React.Children.toArray(children).some(
            child => React.isValidElement<SegmentedControlButtonProps | SegmentedControlIconButtonProps>(child) &&
                     child.props.defaultSelected !== undefined
        );

    const selectedSegments = React.Children.toArray(children).map(
        child =>
            React.isValidElement<SegmentedControlButtonProps | SegmentedControlIconButtonProps>(child) &&
            (child.props.defaultSelected || child.props.selected)
    );

    const hasSelectedButton = selectedSegments.some(isSelected => isSelected);
    const selectedIndexExternal = hasSelectedButton ? selectedSegments.indexOf(true) : 0;
    const [selectedIndexInternalState, setSelectedIndexInternalState] = React.useState<number>(selectedIndexExternal);
    const selectedIndex = isUncontrolled ? selectedIndexInternalState : selectedIndexExternal;

    if (!ariaLabel && !ariaLabelledby) {
        console.warn(
            'Use the `aria-label` or `aria-labelledby` prop to provide an accessible label for assistive technologies'
        );
    }

    return (
        <ul
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            aria-describedby={ariaDescribedby}
            className={classNames(
                styles.segmented_control,
                {
                    [styles.full_width]: fullWidth,
                    [styles.size_small]: size === SegmentedControlSize.Small,
                },
                className
            )}
        >
            {React.Children.map(children, (child, index) => {
                if (!React.isValidElement<SegmentedControlButtonProps | SegmentedControlIconButtonProps>(child)) {
                    return null;
                }

                const sharedChildProps = {
                    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
                        const isDisabled =
                            child.props.disabled === true ||
                            child.props['aria-disabled'] === 'true' ||
                            child.props['aria-disabled'] === true;

                        if (!isDisabled) {
                            onChange?.(index);
                            isUncontrolled && setSelectedIndexInternalState(index);
                            child.props.onClick?.(event);
                        }
                    },
                    selected: index === selectedIndex,
                };

                return React.cloneElement(child, sharedChildProps);
            })}
        </ul>
    );
};

// ==================== Export ====================

export const SegmentedControl = Object.assign(Root, {
    Button: SegmentedControlButton,
    IconButton: SegmentedControlIconButton,
});
