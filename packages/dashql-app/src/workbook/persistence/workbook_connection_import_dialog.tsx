import * as React from 'react';

import { Button, ButtonVariant } from '@akohn/dashql-react/components/button';
import { Overlay, OverlaySize } from '@akohn/dashql-react/components/overlay';
import type * as core from '@akohn/dashql';

import * as styles from './workbook_import_conflict_dialog.module.css';
import * as ownStyles from './workbook_connection_import_dialog.module.css';

interface Props {
    /// The name of the imported workbook
    workbookName: string;
    /// The connections of the workbook that may consolidate with existing connections
    questions: core.ImportQuestion[];
    /// Is the import running?
    busy: boolean;
    /// Import with the chosen connections, keyed by the connection id in the workbook
    onConfirm: (choices: Map<string, core.ImportChoice>) => void;
    /// Abort the import
    onCancel: () => void;
}

/// The value of a choice in the form
function choiceValue(choice: core.ImportChoice): string {
    return choice.kind === 'link' ? `link:${choice.connectionId}` : 'separate';
}

/// Ask the user whether imported connections should use existing connections.
/// Using an existing connection keeps settings in one place, the workbook then shares the connection
/// with every other workbook that uses it.
export function WorkbookConnectionImportDialog(props: Props): React.ReactElement {
    const titleId = React.useId();
    const descriptionId = React.useId();
    const dialogRef = React.useRef<HTMLElement>(null);
    const [choices, setChoices] = React.useState(() => new Map<string, core.ImportChoice>(props.questions.map(item => [
        item.connectionId,
        item.candidates.length > 0 ? { kind: 'link', connectionId: item.candidates[0].id } : { kind: 'separate' },
    ])));
    const cancel = React.useCallback(() => {
        if (!props.busy) props.onCancel();
    }, [props.busy, props.onCancel]);

    return (
        <Overlay centered width={OverlaySize.L} onEscape={cancel} onClickOutside={cancel} initialFocusRef={dialogRef}>
            <section
                ref={dialogRef}
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                aria-busy={props.busy}
                tabIndex={-1}
            >
                <header className={styles.header}>
                    <h2 id={titleId}>Use existing connections?</h2>
                </header>
                <div className={styles.body}>
                    <p id={descriptionId} className={styles.description}>
                        The workbook {props.workbookName} uses connections that look like connections you already have.
                        Using an existing connection shares its settings with the workbooks that already use it.
                    </p>
                    {props.questions.map(item => {
                        const current = choices.get(item.connectionId);
                        const name = `connection-${item.connectionId}`;
                        const options: Array<{ choice: core.ImportChoice; label: string }> = [
                            ...item.candidates.map(candidate => ({
                                choice: { kind: 'link' as const, connectionId: candidate.id },
                                label: `Use ${candidate.name ?? candidate.paramsLabel}`,
                            })),
                            { choice: { kind: 'separate' }, label: 'Keep as a new connection' },
                        ];
                        return (
                            <fieldset key={item.connectionId} className={ownStyles.connection} disabled={props.busy}>
                                <legend className={ownStyles.connection_label}>
                                    {item.name == null ? item.paramsLabel : `${item.name} · ${item.paramsLabel}`}
                                </legend>
                                {options.map(option => (
                                    <label key={choiceValue(option.choice)} className={ownStyles.option}>
                                        <input
                                            type="radio"
                                            name={name}
                                            value={choiceValue(option.choice)}
                                            checked={current != null && choiceValue(current) === choiceValue(option.choice)}
                                            onChange={() => setChoices(prev => new Map(prev).set(item.connectionId, option.choice))}
                                        />
                                        {option.label}
                                    </label>
                                ))}
                            </fieldset>
                        );
                    })}
                </div>
                <footer className={styles.actions}>
                    <Button disabled={props.busy} onClick={cancel}>Cancel</Button>
                    <Button variant={ButtonVariant.Primary} disabled={props.busy} onClick={() => props.onConfirm(choices)}>
                        Import
                    </Button>
                </footer>
            </section>
        </Overlay>
    );
}
