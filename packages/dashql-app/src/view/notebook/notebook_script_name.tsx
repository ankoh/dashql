import * as React from 'react';

import * as styles from './notebook_script_name.module.css';

interface Props {
    /// The folder
    folder: string;
    /// The file
    file: string;
    /// Optional icon rendered before the file name
    icon?: React.ReactNode;
}

export function NotebookScriptName(props: Props) {
    return (
        <span className={styles.container}>
            <span className={styles.folder_name}>
                {props.folder}
            </span>
            <span className={styles.separator}>
                /
            </span>
            <span className={styles.file_name}>
                {props.icon && <span className={styles.file_icon}>{props.icon}</span>}
                {props.file}
            </span>
        </span>
    )

}
