import * as React from 'react';
import * as styles from './session_feed.module.css';

import { renderScriptReference, SCRIPT_REFERENCE_PREFIX } from '../../ai/script_references.js';

interface Props {
    /// The display name of the script
    scriptName: string;
    /// Can the script be mentioned?
    canTarget: boolean;
    /// Mention the script at the cursor of the last focused editor, a script or the prompt
    onTarget: () => void;
    /// Is the name being edited?
    renaming: boolean;
    /// Start or stop editing the name
    onRenamingChange: (renaming: boolean) => void;
    /// Rename the script, the name is the new display name
    onRename: (name: string) => void;
}

/// The ":<script>" tag of a script card.
/// A click mentions the script at the cursor of the editor that had the focus last, another script or the prompt.
/// While the name is being edited, the tag is an input.
export const ScriptMentionTag: React.FC<Props> = (props) => {
    if (props.renaming) {
        return <ScriptNameInput {...props} />;
    }
    return (
        <button
            type="button"
            className={styles.feed_entry_mention}
            // The editor keeps the focus and its cursor
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
                event.stopPropagation();
                if (props.canTarget) props.onTarget();
            }}
            aria-label={`Mention ${props.scriptName} at the cursor`}
            aria-disabled={props.canTarget ? undefined : 'true'}
            title={`Insert ${renderScriptReference(props.scriptName)} at the cursor`}
            data-testid="script-mention"
        >
            {renderScriptReference(props.scriptName)}
        </button>
    );
};

function ScriptNameInput(props: Props) {
    const [draft, setDraft] = React.useState(props.scriptName);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const doneRef = React.useRef(false);
    // Focus after the frame, a closing menu returns the focus to its trigger first
    React.useEffect(() => {
        const frame = requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        });
        return () => cancelAnimationFrame(frame);
    }, []);
    const finish = (commit: boolean) => {
        if (doneRef.current) return;
        doneRef.current = true;
        const name = draft.trim();
        if (commit && name && name !== props.scriptName) props.onRename(name);
        props.onRenamingChange(false);
    };
    return (
        <span className={styles.feed_entry_mention} data-editing="">
            <span aria-hidden="true">{SCRIPT_REFERENCE_PREFIX}</span>
            <input
                ref={inputRef}
                className={styles.feed_entry_mention_input}
                type="text"
                aria-label={`Rename ${props.scriptName} script`}
                data-testid="script-name-input"
                value={draft}
                size={Math.max(draft.length, 1)}
                spellCheck={false}
                onChange={event => setDraft(event.currentTarget.value)}
                onBlur={() => finish(true)}
                onKeyDown={(event) => {
                    // The feed must not see the keys, Enter would accept a rewrite
                    event.stopPropagation();
                    if (event.key === 'Enter') finish(true);
                    else if (event.key === 'Escape') finish(false);
                }}
                onClick={event => event.stopPropagation()}
                onPointerDown={event => event.stopPropagation()}
            />
        </span>
    );
}
