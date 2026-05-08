import * as React from 'react';

import * as styles from './notebook_script_name.module.css';

interface Props {
    /// The folder
    folder: string;
    /// The file
    file: string;
    /// Optional icon rendered before the file name
    icon?: React.ReactNode;
    /// Optional content rendered inside the file-name chip after the file label (e.g. action buttons)
    fileNameTrailing?: React.ReactNode;
    /// When set, the file label is replaced by an editable input rendered inside the chip
    editing?: {
        value: string;
        onChange: (value: string) => void;
        onCommit: () => void;
        onCancel: () => void;
        inputRef?: React.Ref<HTMLInputElement>;
    };
    /// Optional click handler for the file-name chip (ignored while editing)
    onFileClick?: (event: React.MouseEvent<HTMLSpanElement>) => void;
    /// Optional click handler for the folder name
    onFolderClick?: (event: React.MouseEvent<HTMLSpanElement>) => void;
}

export function NotebookScriptName(props: Props) {
    const isEditing = props.editing != null;
    const handleFileClick = (event: React.MouseEvent<HTMLSpanElement>) => {
        if (isEditing) return;
        props.onFileClick?.(event);
    };
    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (!props.editing) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            props.editing.onCommit();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            props.editing.onCancel();
        }
    };
    return (
        <span className={styles.container}>
            <span
                className={props.onFolderClick ? styles.folder_name_clickable : styles.folder_name}
                onClick={props.onFolderClick}
            >
                {props.folder}
            </span>
            <span className={styles.separator}>
                /
            </span>
            <span
                className={isEditing ? styles.file_name_editing : styles.file_name}
                onClick={handleFileClick}
            >
                {props.icon && <span className={styles.file_icon}>{props.icon}</span>}
                {props.editing ? (
                    <input
                        ref={props.editing.inputRef}
                        type="text"
                        className={styles.file_name_input}
                        value={props.editing.value}
                        onChange={(e) => props.editing!.onChange(e.target.value)}
                        onBlur={props.editing.onCommit}
                        onKeyDown={handleKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    />
                ) : (
                    <>
                        {props.file}
                        {props.fileNameTrailing && (
                            <span className={styles.file_name_trailing}>
                                {props.fileNameTrailing}
                            </span>
                        )}
                    </>
                )}
            </span>
        </span>
    )

}
