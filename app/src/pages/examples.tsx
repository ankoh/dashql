import * as React from 'react';
import * as core from '@dashql/core';
import classNames from 'classnames';
import Button from 'react-bootstrap/Button';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { motion, AnimateSharedLayout, AnimatePresence } from 'framer-motion';
import { EXAMPLE_SCRIPTS, EXAMPLE_SCRIPT_MAP, ScriptFeatureTag, ExampleScriptMetadata } from '../examples';

import styles from './examples.module.css';
import icon_close from '../../static/svg/icons/close_grey.svg';

interface Props {
    className?: string;
}

interface State {
    filteredFeatures: core.utils.NativeBitmap;
    focusedExample: string | null;
}

function getFeatureTagLabel(tag: ScriptFeatureTag) {
    switch (tag) {
        case ScriptFeatureTag.LOAD_HTTP:
            return 'HTTP';
        case ScriptFeatureTag.EXTRACT_CSV:
            return 'CSV';
        case ScriptFeatureTag.EXTRACT_JSON:
            return 'JSON';
        case ScriptFeatureTag.EXTRACT_PARQUET:
            return 'PARQUET';
        case ScriptFeatureTag.VIZ_LINE_CHART:
            return 'LINE CHART';
        case ScriptFeatureTag.VIZ_TABLE:
            return 'TABLE';
        default:
            return '?';
    }
}

class Explorer extends React.Component<Props, State> {
    _focusExample = this.focusExample.bind(this);
    _clearFocus = this.clearFocus.bind(this);
    _toggleFeature = this.toggleFeature.bind(this);

    constructor(props: Props) {
        super(props);
        this.state = {
            filteredFeatures: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
            focusedExample: null,
        };
    }

    clearFocus() {
        this.setState({
            ...this.state,
            focusedExample: null,
        });
    }

    focusExample(elem: React.MouseEvent<HTMLDivElement>) {
        this.setState({
            ...this.state,
            focusedExample: (elem.currentTarget as any).dataset.key || null,
        });
    }

    toggleFeature(elem: React.MouseEvent<HTMLDivElement>) {
        this.setState({
            ...this.state,
            filteredFeatures: this.state.filteredFeatures.flip((elem.currentTarget as any).dataset.feature!),
        });
    }

    renderFeatureFilters() {
        let features = [];
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

    renderScriptDetail(name: string) {
        const script = EXAMPLE_SCRIPT_MAP.get(name)!;
        return (
            <motion.div className={styles.script_detail} layoutId={script.key}>
                <motion.div className={styles.example_icon}>
                    <img src={script.icon} width="20" height="20" />
                </motion.div>
                <motion.span className={styles.example_title}>{script.title}</motion.span>
                <motion.span className={styles.example_description}>{script.description}</motion.span>
                <Button size="sm" variant="light" className={styles.example_unfocus} onClick={this._clearFocus}>
                    <img src={icon_close} width="20" height="20" />
                </Button>
            </motion.div>
        );
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
                            className={styles.script_card}
                            key={script.key}
                            layoutId={script.key}
                            data-key={script.key}
                            onClick={this._focusExample}
                        >
                            <motion.div className={styles.example_icon}>
                                <img src={script.icon} width="20" height="20" />
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
                let c = o.get(script.collection) || [];
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
                    <div className={styles.gallery_filters}>
                        {this.renderFeatureFilters()}
                    </div>
                </div>
                <AnimateSharedLayout type="crossfade">
                    {this.renderCollection(collections, 'Demos')}
                    {this.renderCollection(collections, 'Load')}
                    {this.renderCollection(collections, 'Extract')}
                    {this.renderCollection(collections, 'SQL')}
                    {this.renderCollection(collections, 'Visualize')}
                    <AnimatePresence>
                        {this.state.focusedExample && this.renderScriptDetail(this.state.focusedExample)}
                    </AnimatePresence>
                </AnimateSharedLayout>
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(Explorer);
