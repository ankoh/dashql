import * as React from 'react';
import Immutable from 'immutable';
import { getScriptName, Script } from '../model';
import { CommandButton } from '../components';

import styles from './script_entry.module.css';
import icon_more from '../../static/svg/icons/dots_vertical.svg';

interface EntryProps {
    className?: string;
    script?: Script;
}

export const LocalScriptEntry: React.FC<EntryProps> = (props: EntryProps) => {
    const scriptName = getScriptName(props.script);
    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.title}>{scriptName}</div>
                <CommandButton disabled className={styles.command} width="20px" height="20px" icon={icon_more} />
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

export const ScriptEntry: React.FC<EntryProps> = (props: EntryProps) => {
    const scriptName = getScriptName(props.script);
    // const stars = 42;
    // const starTrend = 1.0;
    // const views = 48;
    // const viewTrend = 1.0;
    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.title}>{scriptName}</div>
                <CommandButton disabled className={styles.command} width="16px" height="16px" icon={icon_more} />
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

export const LocalScriptEntryCollection: React.FC<CollectionProps> = (props: CollectionProps) => {
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
        out.push(<LocalScriptEntry key={key} script={value} />);
    });
    return (
        <div className={styles.collection}>
            <div className={styles.collection_name}>{props.name}</div>
            <div className={styles.collection_grid}>{out}</div>
        </div>
    );
};

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
        out.push(<ScriptEntry key={key} script={value} />);
    });
    return (
        <div className={styles.collection}>
            <div className={styles.collection_name}>{props.name}</div>
            <div className={styles.collection_grid}>{out}</div>
        </div>
    );
};
