import * as React from 'react';
import Immutable from 'immutable';
import { getScriptName, Script } from '../model';
import { CommandButton } from '../components';

import styles from './script_entry.module.css';
import icon_delete from '../../static/svg/icons/file_outline.svg';

interface Props {
    className?: string;
    script?: Script;
}

export const ScriptEntry: React.FC<Props> = (props: Props) => {
    const scriptName = getScriptName(props.script);
    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.title}>{scriptName}</div>
                <CommandButton width="16px" height="16px" icon={icon_delete} />
            </div>
            <div
                className={styles.body}
                onMouseDown={e => {
                    e.preventDefault();
                    e.stopPropagation();
                }}
            ></div>
        </div>
    );
};

interface CollectionProps {
    name: string;
    scripts: Immutable.Map<string, Script>;
    fallback: string;
}

export const ScriptEntryCollection: React.FC<CollectionProps> = (props: CollectionProps) => {
    if (props.scripts.size == 0) {
        return (
            <div className={styles.collection}>
                <div className={styles.collection_name}>{props.name}</div>
                <div className={styles.collection_grid_placeholder}>{props.fallback}</div>
            </div>
        );
    }
    const out: React.ReactElement[] = [];
    props.scripts.forEach((value, key) => {
        out.push(<ScriptEntry script={value} />);
    });
    return (
        <div className={styles.collection}>
            <div className={styles.collection_name}>{props.name}</div>
            <div className={styles.collection_grid}>{out}</div>
        </div>
    );
};
