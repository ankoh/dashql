import * as React from 'react';
import * as core from '@dashql/core';
import * as examples from '../example_scripts';
import classNames from 'classnames';
import { withAppContext, IAppContext } from '../app_context';
import { withRouter, RouteComponentProps } from 'react-router-dom';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { motion, AnimateSharedLayout } from 'framer-motion';
import { EXAMPLE_SCRIPTS, EXAMPLE_SCRIPT_MAP, ScriptFeatureTag, ExampleScriptMetadata } from '../example_scripts';

import styles from './examples.module.css';

function getFeatureTagLabel(tag: ScriptFeatureTag) {
    switch (tag) {
        case ScriptFeatureTag.FETCH_HTTP:
            return 'HTTP';
        case ScriptFeatureTag.FETCH_ARCHIVE_ZIP:
            return 'ZIP ARCHIVE';
        case ScriptFeatureTag.DATA_CSV:
            return 'CSV';
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

interface Props extends RouteComponentProps {
    appContext: IAppContext;
    className?: string;
    setProgram: (program: core.model.Program) => void;
}

interface State {
    filteredFeatures: core.utils.NativeBitmap;
}

class Examples extends React.Component<Props, State> {
    _selectExample = this.selectExample.bind(this);
    _toggleFeature = this.toggleFeature.bind(this);

    constructor(props: Props) {
        super(props);
        this.state = {
            filteredFeatures: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        };
    }

    async selectExample(elem: React.MouseEvent<HTMLDivElement>) {
        const key = (elem.currentTarget as any).dataset.key;
        const analyzer = this.props.appContext.platform!.analyzer;
        const script = await examples.getScript(EXAMPLE_SCRIPT_MAP.get(key)!);
        const program = analyzer.parseProgram(script.text);
        this.props.setProgram(program);
        this.props.history.push('/studio');
    }

    toggleFeature(elem: React.MouseEvent<HTMLDivElement>) {
        this.setState({
            ...this.state,
            filteredFeatures: this.state.filteredFeatures.flip((elem.currentTarget as any).dataset.feature!),
        });
    }

    renderFeatureFilters() {
        const features = [];
        for (let i = 0; i < ScriptFeatureTag._COUNT_; ++i) {
            features.push(
                <div
                    key={i}
                    className={classNames(styles.filter_tag, {
                        [styles.filter_tag_active]: this.state.filteredFeatures.isSet(i),
                    })}
                    onClick={this._toggleFeature}
                    data-feature={i}
                >
                    {getFeatureTagLabel(i as ScriptFeatureTag)}
                </div>,
            );
        }
        return <div className={styles.filter_grid}>{features}</div>;
    }

    renderCollection(collections: Map<string, ExampleScriptMetadata[]>, name: string) {
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
                            key={script.key}
                            layoutId={script.key}
                            data-key={script.key}
                            onClick={script.enabled ? this._selectExample : () => {}}
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
    }

    public render() {
        const collections = EXAMPLE_SCRIPTS.filter(s => s.features.containsUnsafe(this.state.filteredFeatures)).reduce(
            (o, script) => {
                const c = o.get(script.collection) || [];
                c.push(script);
                o.set(script.collection, c);
                return o;
            },
            new Map<string, ExampleScriptMetadata[]>(),
        );

        return (
            <div className={styles.root}>
                <div className={styles.gallery_header}>
                    <div className={styles.gallery_header_title}>Example Gallery</div>
                    <div className={styles.gallery_filters}>{this.renderFeatureFilters()}</div>
                </div>
                <div className={styles.gallery_body}>
                    <AnimateSharedLayout type="crossfade">
                        {this.renderCollection(collections, 'Demos')}
                        {this.renderCollection(collections, 'Fetch')}
                        {this.renderCollection(collections, 'Load')}
                        {this.renderCollection(collections, 'SQL')}
                        {this.renderCollection(collections, 'Visualize')}
                    </AnimateSharedLayout>
                </div>
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({});

const mapDispatchToProps = (dispatch: Dispatch) => ({
    setProgram: (program: core.model.Program) => {
        dispatch({
            type: core.model.StateMutationType.SET_PROGRAM,
            data: program,
        });
    },
});

export default connect(mapStateToProps, mapDispatchToProps)(withRouter(withAppContext(Examples)));
