import * as React from 'react';

import { classNames } from '../../utils/classnames.js';
import { sessionInputControl, SessionInputControl, type SessionInput } from './session_inputs.js';

import * as styles from './session_inputs.module.css';

/// How a card is drawn: a chip in the strip of the feed and the dashboard, a block in a box of the dataflow
export type SessionInputCardVariant = 'chip' | 'block';

interface Props {
    input: SessionInput;
    /// The literal of a value of the control in the Hyper dialect, or the problem with the value
    literalOf: (input: SessionInput, value: string) => { literal: string } | { error: string };
    /// Write the literal and run the scripts that use the input
    onCommit: (name: string, literal: string) => void;
    /// Do the scripts of the input run?
    busy?: boolean;
    variant?: SessionInputCardVariant;
    className?: string;
}

/// A `datetime-local` value from a SQL timestamp, null if the control can't show it
function toDateTimeLocal(value: string): string | null {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)$/.exec(value.trim());
    return match == null ? null : `${match[1]}T${match[2]}`;
}

/// A SQL timestamp from a `datetime-local` value
function fromDateTimeLocal(value: string): string {
    return value.replace('T', ' ');
}

/// The units of an interval, an interval is a number and one unit (docs/design/session_inputs.md)
const INTERVAL_UNITS = ['year', 'month', 'day', 'hour', 'minute', 'second'];

/// The amount and the unit of the value of an interval, `3 day`, the unit is null without one
function splitInterval(value: string): { amount: string; unit: string | null } {
    const match = /^\s*(\S*)\s+(\S+)\s*$/.exec(value);
    return match == null ? { amount: value.trim(), unit: null } : { amount: match[1], unit: match[2].toLowerCase() };
}

const PLACEHOLDERS: Partial<Record<SessionInputControl, string>> = {
    [SessionInputControl.Interval]: '3',
    [SessionInputControl.Number]: '0',
    [SessionInputControl.Integer]: '0',
};

/// The value of an input in a card: the name of the parameter, its type and a control that follows the type. The
/// control owns its draft, Enter writes it as literal and runs the scripts that use the input, Escape restores the
/// value.
export function SessionInputCard(props: Props): React.ReactElement {
    const { input, onCommit, literalOf } = props;
    const value = input.value ?? '';
    let control = sessionInputControl(input.type);
    // A timestamp that the picker can't show is text
    if (control === SessionInputControl.Timestamp && value.length > 0 && toDateTimeLocal(value) == null) control = SessionInputControl.Text;
    const shown = control === SessionInputControl.Timestamp ? (toDateTimeLocal(value) ?? '') : value;
    const [draft, setDraft] = React.useState(shown);
    React.useEffect(() => setDraft(shown), [shown]);
    const committed = control === SessionInputControl.Timestamp ? fromDateTimeLocal(draft) : draft;
    const dirty = draft !== shown;
    const result = React.useMemo(() => literalOf(input, committed), [literalOf, input, committed]);
    const problem = draft.trim().length === 0 || !('error' in result) ? null : result.error;
    const unset = input.value == null;
    // The unit of an interval without an amount, the draft holds the unit once it has one
    const [emptyUnit, setEmptyUnit] = React.useState('day');
    const interval = splitInterval(draft);
    const intervalUnit = interval.unit ?? emptyUnit;

    const commit = React.useCallback((next: string) => {
        const literal = literalOf(input, next);
        if ('literal' in literal) onCommit(input.name, literal.literal);
    }, [input, literalOf, onCommit]);
    const onKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commit(committed);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(shown);
            event.currentTarget.blur();
        } else {
            return;
        }
        event.stopPropagation();
    }, [commit, committed, shown]);

    const label = `Value of :${input.name}`;
    const typeTitle = input.type.cast
        ? `Cast to ${input.type.sql}`
        : input.type.known ? `The type of the value ${input.literal ?? ''}` : 'Without a value or a cast, the input is text';
    const title = problem ?? input.warnings[0] ?? (unset ? 'The input has no value, the scripts that use it fail' : input.literal ?? undefined);
    return (
        <div
            className={classNames(styles.card, props.className, { [styles.card_block]: props.variant === 'block' })}
            data-session-input={input.name}
            data-dirty={dirty || undefined}
            data-invalid={problem != null || undefined}
            data-unset={(unset && !dirty) || undefined}
            data-busy={props.busy || undefined}
            title={title}
            onPointerDown={event => event.stopPropagation()}
        >
            {props.variant !== 'block' && <span className={styles.name}>:{input.name}</span>}
            {props.variant !== 'block' && <span className={styles.type} data-inferred={!input.type.cast || undefined} title={typeTitle}>{input.type.sql}</span>}
            {control === SessionInputControl.Interval ? (
                <>
                    <input
                        className={classNames(styles.control, styles.control_amount)}
                        aria-label={label}
                        type="text"
                        inputMode="decimal"
                        value={interval.amount}
                        placeholder={PLACEHOLDERS[control]}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={event => {
                            const amount = event.currentTarget.value.replace(/\s+/g, '');
                            setDraft(amount.length === 0 ? '' : `${amount} ${intervalUnit}`);
                        }}
                        onKeyDown={onKeyDown}
                    />
                    <select
                        className={classNames(styles.control, styles.control_unit)}
                        aria-label={`Unit of :${input.name}`}
                        value={intervalUnit}
                        onChange={event => {
                            const unit = event.currentTarget.value;
                            if (interval.amount.length === 0) {
                                setEmptyUnit(unit);
                                return;
                            }
                            const next = `${interval.amount} ${unit}`;
                            setDraft(next);
                            commit(next);
                        }}
                    >
                        {!INTERVAL_UNITS.includes(intervalUnit) && <option value={intervalUnit} disabled>{intervalUnit}</option>}
                        {INTERVAL_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                    </select>
                </>
            ) : control === SessionInputControl.Boolean ? (
                <select
                    className={styles.control}
                    aria-label={label}
                    value={/^(true|false)$/i.test(draft) ? draft.toLowerCase() : ''}
                    onChange={event => {
                        setDraft(event.currentTarget.value);
                        if (event.currentTarget.value !== '') commit(event.currentTarget.value);
                    }}
                >
                    <option value="" disabled>unset</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                </select>
            ) : (
                <input
                    className={styles.control}
                    aria-label={label}
                    type={control === SessionInputControl.Date ? 'date' : control === SessionInputControl.Timestamp ? 'datetime-local' : 'text'}
                    inputMode={control === SessionInputControl.Number || control === SessionInputControl.Integer ? 'decimal' : undefined}
                    step={control === SessionInputControl.Timestamp ? 1 : undefined}
                    value={draft}
                    placeholder={PLACEHOLDERS[control] ?? 'value'}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={event => setDraft(event.currentTarget.value)}
                    onKeyDown={onKeyDown}
                />
            )}
            <span className={styles.status} aria-hidden="true" />
        </div>
    );
}
