import * as React from 'react';

interface Props {
    /// The persisted name, null if there is none
    name: string | null;
    /// Commit an edited name, blank input means no name
    onCommit: (name: string) => void;
    /// Abandon the edit with Escape
    onCancel?: () => void;
    /// The accessible label
    ariaLabel: string;
    /// The placeholder while there is no name
    placeholder: string;
    /// The class of the input
    className?: string;
    /// Focus the input with its text selected when it shows, e.g. when a rename starts
    autoSelect?: boolean;
}

/// An editable name. The input owns its draft so typing does not rerender the surrounding view;
/// blur or Enter commits the draft, Escape restores the persisted name.
export const NameInput = React.forwardRef<HTMLInputElement, Props>((props, forwardedRef) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const skipBlurCommitRef = React.useRef(false);
    const { name, onCommit, onCancel, autoSelect } = props;
    React.useImperativeHandle(forwardedRef, () => inputRef.current!, []);
    React.useEffect(() => {
        if (!autoSelect) return;
        const select = () => {
            inputRef.current?.focus();
            inputRef.current?.select();
        };
        select();
        // A closing menu returns the focus to its trigger after the input showed, the input takes it back
        const frame = requestAnimationFrame(() => {
            if (document.activeElement !== inputRef.current) select();
        });
        return () => cancelAnimationFrame(frame);
    }, [autoSelect]);
    // Re-sync the draft when the persisted name changes (e.g. a rename from elsewhere, or switching
    // the named object while the input stays mounted).
    React.useEffect(() => {
        if (inputRef.current != null) inputRef.current.value = name ?? '';
    }, [name]);

    const commitOnBlur = React.useCallback((e: React.FocusEvent<HTMLInputElement>) => {
        if (!skipBlurCommitRef.current) onCommit(e.currentTarget.value);
    }, [onCommit]);
    // Drop the focus without a commit. blur() fires its event synchronously, and none at all while the
    // window lacks focus, so the keys cannot leave it to the event to commit or to reset the flag.
    const blurWithoutCommit = React.useCallback((input: HTMLInputElement) => {
        skipBlurCommitRef.current = true;
        input.blur();
        skipBlurCommitRef.current = false;
    }, []);
    const onKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            onCommit(e.currentTarget.value);
            blurWithoutCommit(e.currentTarget);
        } else if (e.key === 'Escape') {
            // Abandon the edit: restore the persisted value and drop focus.
            e.currentTarget.value = name ?? '';
            blurWithoutCommit(e.currentTarget);
            onCancel?.();
        }
        e.stopPropagation();
    }, [name, onCommit, onCancel, blurWithoutCommit]);
    const onPointerDown = React.useCallback((e: React.PointerEvent<HTMLInputElement>) => {
        // Inputs are often portaled from sortable rows. Keep selection gestures from bubbling
        // through the React tree and activating a drag sensor.
        e.stopPropagation();
    }, []);

    return (
        <input
            ref={inputRef}
            className={props.className}
            type="text"
            aria-label={props.ariaLabel}
            defaultValue={name ?? ''}
            placeholder={props.placeholder}
            spellCheck={false}
            onBlur={commitOnBlur}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
        />
    );
});
