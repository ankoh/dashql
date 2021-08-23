import * as React from 'react';
import * as model from '../model';
import * as utils from '../utils';
import * as examples from '../example_scripts';
import classNames from 'classnames';
import { useNavigate } from 'react-router-dom';
import { motion, AnimateSharedLayout } from 'framer-motion';
import { EXAMPLE_SCRIPTS, EXAMPLE_SCRIPT_MAP, ScriptFeatureTag, ExampleScriptMetadata } from '../example_scripts';
import { useAnalyzer } from '../analyzer';

import styles from './examples.module.css';

function getFeatureTagLabel(tag: ScriptFeatureTag) {
    switch (tag) {
        case ScriptFeatureTag.FETCH_HTTP:
            return 'HTTP';
        case ScriptFeatureTag.FETCH_ARCHIVE_ZIP:
            return 'ZIP ARCHIVE';
        case ScriptFeatureTag.TRANSFORM_JMESPATH:
            return 'JMESPATH';
        case ScriptFeatureTag.DATA_CSV:
            return 'CSV';
        case ScriptFeatureTag.DATA_JSON:
            return 'JSON';
        case ScriptFeatureTag.DATA_PARQUET:
            return 'PARQUET';
        case ScriptFeatureTag.DYNAMIC_LOAD:
            return 'DYNAMIC LOAD';
        case ScriptFeatureTag.DYNAMIC_SQL:
            return 'DYNAMIC SQL';
        case ScriptFeatureTag.DYNAMIC_VIZ:
            return 'DYNAMIC VIZ';
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
    const analyzer = useAnalyzer();
    const navigate = useNavigate();
    const programDispatch = model.useProgramContextDispatch();
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

    const selectExample = async (elem: React.MouseEvent<HTMLDivElement>) => {
        const key = (elem.currentTarget as any).dataset.key;
        const nextScript = await examples.getScript(EXAMPLE_SCRIPT_MAP.get(key)!);
        const program = analyzer.parseProgram(nextScript.text);
        programDispatch({
            type: model.REPLACE_PROGRAM,
            data: [program, nextScript],
        });
        navigate('/explorer');
    };

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
                <div className={styles.gallery_header_title}>Example Library</div>
                <div className={styles.gallery_filters}>
                    <div className={styles.filter_grid}>{features}</div>
                </div>
            </div>
            <div className={styles.gallery_body}>
                <AnimateSharedLayout type="crossfade">
                    {renderCollection(collections, 'Demos')}
                    {renderCollection(collections, 'Fetch')}
                    {renderCollection(collections, 'Transform')}
                    {renderCollection(collections, 'Load')}
                    {renderCollection(collections, 'SQL')}
                    {renderCollection(collections, 'Visualize')}
                </AnimateSharedLayout>
            </div>
        </div>
    );
};
