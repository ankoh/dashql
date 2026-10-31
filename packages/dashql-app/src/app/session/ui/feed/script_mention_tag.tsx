import * as React from 'react';
import * as styles from './session_feed.module.css';

import { renderScriptReference, SCRIPT_REFERENCE_PREFIX } from '../../ai/script_references.js';

interface Props {
    /// The display name of the script
    scriptName: string;
    /// Can a question of the composer target the script?
    canTarget: boolean;
    /// Reference the script in the question of the composer
    onTarget: () => void;
    /// Is the name being edited?
    renaming: boolean;
    /// Start or stop editing the name
    onRenamingChange: (renaming: boolean) => void;
    /// Rename the script, the name is the new display name
    onRename: (name: string) => void;
}

/// The "@<script>" tag of a script card.
/// A click mentions the script in the prompt, a double click edits the name in place.
export const ScriptMentionTag: React.FC<Props> = (props) => {
    if (props.renaming) {
        return <ScriptNameInput {...props} />;
    }
    return (
        <button
            type="button"
            className={styles.feed_entry_mention}
            onClick={(event) => {
                event.stopPropagation();
                // The second click of a double click renames, it does not mention again
                if (props.canTarget && event.detail < 2) props.onTarget();
            }}
            onDoubleClick={(event) => { event.stopPropagation(); props.onRenamingChange(true); }}
            aria-label={`Mention ${props.scriptName} in the prompt`}
            aria-disabled={props.canTarget ? undefined : 'true'}
            title={props.canTarget
                ? `${renderScriptReference(props.scriptName)} (double-click to rename)`
                : 'Start an agent session in the header and connect the agent server to mention scripts in questions'}
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
