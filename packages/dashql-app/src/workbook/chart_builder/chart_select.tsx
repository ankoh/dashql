import * as React from 'react';

import * as ActionList from '@akohn/dashql-react/components/action_list';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { Button, ButtonSize, ButtonVariant } from '@akohn/dashql-react/components/button';
import { TriangleDownIcon } from '@akohn/dashql-react/components/symbol_icon';
import * as styles from './chart_builder.module.css';

export interface ChartSelectOption {
    value: string;
    label: string;
    description?: string;
}

interface Props {
    /// The accessible name of the trigger
    'aria-label': string;
    'data-testid'?: string;
    /// The picked value, null shows the placeholder
    value: string | null;
    /// The label of the trigger when nothing is picked
    placeholder: string;
    options: readonly ChartSelectOption[];
    onChange: (value: string) => void;
    /// The trigger shows a label that differs from the label of the option, e.g. `sum(revenue)`
    triggerLabel?: string;
    variant?: ButtonVariant;
    className?: string;
    disabled?: boolean;
}

/// A dropdown of the chart builder: a button that opens a list of options
export function ChartSelect(props: Props): React.ReactElement {
    const [open, setOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const picked = props.options.find(option => option.value === props.value);
    const label = props.triggerLabel ?? picked?.label ?? props.value ?? props.placeholder;
    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.Start}
            anchorOffset={4}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            renderAnchor={anchorProps => (
                <Button
                    {...anchorProps}
                    ref={triggerRef}
                    className={props.className}
                    variant={props.variant ?? ButtonVariant.Default}
                    size={ButtonSize.Small}
                    disabled={props.disabled}
                    trailingVisual={TriangleDownIcon}
                    aria-label={`${props['aria-label']}: ${label}`}
                    data-testid={props['data-testid']}
                    data-placeholder={props.value == null ? '' : undefined}
                    title={label}
                >
                    <span className={styles.select_label}>{label}</span>
                </Button>
            )}
        >
            <ActionList.List className={styles.select_list} aria-label={props['aria-label']} role="listbox">
                {props.options.map(option => (
                    <ActionList.ListItem
                        key={option.value}
                        role="option"
                        selected={option.value === props.value}
                        data-item={option.value}
                        onClick={() => {
                            setOpen(false);
                            if (option.value !== props.value) props.onChange(option.value);
                        }}
                    >
                        <ActionList.ItemText>
                            <ActionList.ItemTextTitle>{option.label}</ActionList.ItemTextTitle>
                            {option.description != null ? <ActionList.ItemTextDescription>{option.description}</ActionList.ItemTextDescription> : undefined}
                        </ActionList.ItemText>
                    </ActionList.ListItem>
                ))}
            </ActionList.List>
        </AnchoredOverlay>
    );
}
