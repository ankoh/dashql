import * as React from 'react';
import Immutable from 'immutable';
import { getScriptName, getScriptNamespace, Script } from '../model';
import { CommandButton } from '../components';

import styles from './script_entry.module.css';

import icon_more from '../../static/svg/icons/dots_vertical.svg';
import icon_eye from '../../static/svg/icons/eye.svg';
import icon_fork from '../../static/svg/icons/fork.svg';
import icon_star from '../../static/svg/icons/star.svg';

interface EntryProps {
    className?: string;
    script?: Script;
}

const GistInfo = () => (
    <div className={styles.gist_info}>
        <div className={styles.gist_info_entry}>
            <svg className={styles.gist_info_entry_icon}>
                <use xlinkHref={`${icon_eye}#sym`} />
            </svg>
            <div className={styles.gist_info_entry_value}>4k</div>
        </div>
        <div className={styles.gist_info_entry}>
            <svg className={styles.gist_info_entry_icon}>
                <use xlinkHref={`${icon_star}#sym`} />
            </svg>
            <div className={styles.gist_info_entry_value}>4k</div>
        </div>
        <div className={styles.gist_info_entry}>
            <svg className={styles.gist_info_entry_icon}>
                <use xlinkHref={`${icon_fork}#sym`} />
            </svg>
            <div className={styles.gist_info_entry_value}>0</div>
        </div>
    </div>
);

const LocalScriptEntry: React.FC<EntryProps> = (props: EntryProps) => {
    const scriptName = getScriptName(props.script);
    return (
        <div className={styles.container}>
            <div className={styles.header_local}>
                <div className={styles.title}>{scriptName}</div>
                <CommandButton className={styles.command} width="20px" height="20px" icon={icon_more} />
            </div>
        </div>
    );
};

const OwnGistScriptEntry: React.FC<EntryProps> = (props: EntryProps) => {
    const scriptName = getScriptName(props.script);
    // const stars = 42;
    // const starTrend = 1.0;
    // const views = 48;
    // const viewTrend = 1.0;
    return (
        <div className={styles.container}>
            <div className={styles.header_gists_owned}>
                <div className={styles.title}>{scriptName}</div>
                <CommandButton className={styles.command} width="20px" height="20px" icon={icon_more} />
            </div>
            <GistInfo />
        </div>
    );
};

const GistScriptEntry: React.FC<EntryProps> = (props: EntryProps) => {
    const scriptName = getScriptName(props.script);
    const scriptNamespace = getScriptNamespace(props.script);
    // const stars = 42;
    // const starTrend = 1.0;
    // const views = 48;
    // const viewTrend = 1.0;
    return (
        <div className={styles.container}>
            <div className={styles.header_gists}>
                <div className={styles.avatar}>
                    <img src="https://avatars.githubusercontent.com/u/3986510?v=4" width="100%" height="100%" />
                </div>
                <div className={styles.title}>
                    {scriptNamespace}&nbsp;/&nbsp;{scriptName}
                </div>
                <CommandButton className={styles.command} width="20px" height="20px" icon={icon_more} />
            </div>
            <GistInfo />
        </div>
    );
};

interface CollectionProps {
    name: string;
    scripts: Immutable.Map<string, Script>;
    fallback: string;
}

export const LocalScriptCollection: React.FC<CollectionProps> = (props: CollectionProps) => {
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

export const OwnGistScriptCollection: React.FC<CollectionProps> = (props: CollectionProps) => {
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
        out.push(<OwnGistScriptEntry key={key} script={value} />);
    });
    return (
        <div className={styles.collection}>
            <div className={styles.collection_name}>{props.name}</div>
            <div className={styles.collection_grid}>{out}</div>
        </div>
    );
};

export const GistScriptCollection: React.FC<CollectionProps> = (props: CollectionProps) => {
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
        out.push(<GistScriptEntry key={key} script={value} />);
    });
    return (
        <div className={styles.collection}>
            <div className={styles.collection_name}>{props.name}</div>
            <div className={styles.collection_grid}>{out}</div>
        </div>
    );
};
