import * as React from 'react';
import * as utils from '../utils';
import * as examples from '../example_scripts';
import classNames from 'classnames';
import { useNavigate } from 'react-router-dom';
import { motion, LayoutGroup } from 'framer-motion';
import { EXAMPLE_SCRIPTS, EXAMPLE_SCRIPT_MAP, ScriptFeatureTag, ExampleScriptMetadata } from '../example_scripts';

import styles from './examples.module.css';
import { useWorkflowSession } from '../backend/workflow_session';

function getFeatureTagLabel(tag: ScriptFeatureTag) {
    switch (tag) {
        case ScriptFeatureTag.IMPORT_HTTP:
            return 'HTTP';
        case ScriptFeatureTag.JMESPATH:
            return 'JMESPATH';
        case ScriptFeatureTag.DATA_CSV:
            return 'CSV';
        case ScriptFeatureTag.DATA_JSON:
            return 'JSON';
        case ScriptFeatureTag.DATA_PARQUET:
            return 'PARQUET';
        default:
            return '?';
    }
}

interface Props {
    className?: string;
}

interface State {
    features: utils.NativeBitmap;
}

export const Examples: React.FC<Props> = (_props: Props) => {
    const navigate = useNavigate();
    const session = useWorkflowSession();

    // Maintain feature bitmap
    const [state, setState] = React.useState<State>({
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
    });

    const features = [];
    for (let i = 0; i < ScriptFeatureTag._COUNT_; ++i) {
        features.push(
            <div
                key={i}
                className={classNames(styles.filter_tag, {
                    [styles.filter_tag_active]: state.features.isSet(i),
                })}
                onClick={(elem: React.MouseEvent<HTMLDivElement>) => {
                    const feature = (elem.currentTarget as any)?.dataset.feature;
                    if (!feature) return;
                    setState(s => ({
                        features: s.features.flip(feature),
                    }));
                }}
                data-feature={i}
            >
                {getFeatureTagLabel(i as ScriptFeatureTag)}
            </div>,
        );
    }

    const selectExample = React.useCallback(
        async (elem: React.MouseEvent<HTMLDivElement>) => {
            if (session == null) {
                return;
            }

            const key = (elem.currentTarget as any).dataset.key;
            const nextScript = await examples.getScript(EXAMPLE_SCRIPT_MAP.get(key)!);

            session.updateProgram(nextScript.text, nextScript.metadata);
            navigate('/explorer');
        },
        [session],
    );

    const renderCollection = (
        collections: Map<string, ExampleScriptMetadata[]>,
        name: string,
    ): React.ReactElement | undefined => {
        const scripts = collections.get(name);
        if (!scripts) return undefined;
        return (
            <div className={styles.collection}>
                <div className={styles.collection_name}>{name}</div>
                <div className={styles.collection_grid}>
                    {scripts.map(script => (
                        <motion.div
                            className={classNames(styles.script_card, {
                                [styles.script_card_disabled]: !script.enabled,
                            })}
                            key={script.name}
                            layoutId={script.name}
                            data-key={script.name}
                            onClick={script.enabled ? selectExample : () => {}}
                        >
                            <motion.div className={styles.example_icon}>
                                <svg width="20" height="20">
                                    <use xlinkHref={`${script.icon}#sym`} />
                                </svg>
                            </motion.div>
                            <motion.span className={styles.example_title}>{script.title}</motion.span>
                        </motion.div>
                    ))}
                </div>
            </div>
        );
    };

    const collections = EXAMPLE_SCRIPTS.filter(s => s.features.containsUnsafe(state.features)).reduce((o, script) => {
        const c = o.get(script.collection) || [];
        c.push(script);
        o.set(script.collection, c);
        return o;
    }, new Map<string, ExampleScriptMetadata[]>());

    return (
        <div className={styles.root}>
            <div className={styles.gallery_header}>
                <div className={styles.gallery_filters}>
                    <div className={styles.filter_grid}>{features}</div>
                </div>
            </div>
            <div className={styles.gallery_body}>
                <LayoutGroup id="examples">
                    {renderCollection(collections, 'Demos')}
                    {renderCollection(collections, 'Import')}
                    {renderCollection(collections, 'Transform')}
                    {renderCollection(collections, 'Load')}
                    {renderCollection(collections, 'SQL')}
                    {renderCollection(collections, 'Visualize')}
                </LayoutGroup>
            </div>
        </div>
    );
};