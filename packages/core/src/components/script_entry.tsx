import * as React from 'react';
import Immutable from 'immutable';
import Button from 'react-bootstrap/Button';
import { Script } from '../model';

import styles from './script_entry.module.css';

import icon_settings from '../../static/svg/icons/settings.svg';

interface Props {
    className?: string;
    title?: string;
}

export const ScriptEntry: React.FC<Props> = (props: Props) => {
    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.title}>{props.title}</div>
                {false && (
                    <Button size="sm" variant="link" className={styles.settings}>
                        <svg width="14px" height="14px">
                            <use xlinkHref={`${icon_settings}#sym`} />
                        </svg>
                    </Button>
                )}
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
            <div className={styles.script_collection}>
                <div className={styles.script_collection_name}>{props.name}</div>
                <div className={styles.script_collection_grid_placeholder}>{props.fallback}</div>
            </div>
        );
    }
    const out: React.ReactElement[] = [];
    props.scripts.forEach((value, key) => {
        out.push(<ScriptEntry title="foo" />);
    });
    return (
        <div className={styles.script_collection}>
            <div className={styles.script_collection_name}>{props.name}</div>
            <div className={styles.script_collection_grid}>{out}</div>
        </div>
    );
};
