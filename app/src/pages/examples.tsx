import * as React from 'react';
import * as core from '@dashql/core';
import classNames from 'classnames';
import Button from 'react-bootstrap/Button';
import { withRouter, RouteComponentProps } from 'react-router-dom';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { motion, AnimateSharedLayout, AnimatePresence } from 'framer-motion';
import { EXAMPLE_SCRIPTS, EXAMPLE_SCRIPT_MAP, ScriptFeatureTag, ExampleScriptMetadata } from '../example_scripts';

import styles from './examples.module.css';
import icon_close from '../../static/svg/icons/close.svg';

function getFeatureTagLabel(tag: ScriptFeatureTag) {
    switch (tag) {
        case ScriptFeatureTag.HTTP_SOURCE:
            return 'HTTP';
        case ScriptFeatureTag.DATA_CSV:
            return 'CSV';
        case ScriptFeatureTag.DATA_PARQUET:
            return 'PARQUET';
        case ScriptFeatureTag.DYNAMIC_EXTRACT:
            return 'DYNAMIC EXTRACT';
        case ScriptFeatureTag.DYNAMIC_SQL:
            return 'DYNAMIC SQL';
        case ScriptFeatureTag.DYNAMIC_VIZ:
            return 'DYNAMIC VIZ';
        default:
            return '?';
    }
}

interface Props extends RouteComponentProps<{}> {
    className?: string;
}

interface State {
    filteredFeatures: core.utils.NativeBitmap;
    focusedExample: string | null;
}

class Examples extends React.Component<Props, State> {
    _focusExample = this.focusExample.bind(this);
    _viewExample = this.viewExample.bind(this);
    _editExample = this.editExample.bind(this);
    _clearFocus = this.clearFocus.bind(this);
    _toggleFeature = this.toggleFeature.bind(this);

    constructor(props: Props) {
        super(props);
        this.state = {
            filteredFeatures: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
            focusedExample: null,
        };
    }

    focusExample(elem: React.MouseEvent<HTMLDivElement>) {
        const key = (elem.currentTarget as any).dataset.key;
        const loaded = key !== this.state.focusedExample;
        EXAMPLE_SCRIPT_MAP.get(key)!.icon
        this.setState({
            ...this.state,
            focusedExample: key || null,
        });
    }

    viewExample() {
        this.props.history.push('/viewer');
    }

    editExample() {
        this.props.history.push('/studio');
    }

    clearFocus() {
        this.setState({
            ...this.state,
            focusedExample: null,
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
                <motion.div className={styles.script_detail_header}>
                    <motion.div className={styles.example_icon}>
                        <svg width="20" height="20">
                            <use xlinkHref={`${script.icon}#sym`} />
                        </svg>
                    </motion.div>
                    <motion.span className={styles.example_title}>{script.title}</motion.span>
                    <Button size="sm" variant="light" className={styles.example_unfocus} onClick={this._clearFocus}>
                        <svg width="20" height="20">
                            <use xlinkHref={`${icon_close}#sym`} />
                        </svg>
                    </Button>
                </motion.div>
                <motion.span className={styles.example_description}>{script.description}</motion.span>
                <motion.div className={styles.script_detail_actions}>
                    <Button size="sm" onClick={this._viewExample}>
                        View
                    </Button>
                    <Button size="sm" onClick={this._editExample}>
                        Edit
                    </Button>
                </motion.div>
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
                            className={classNames(styles.script_card, {
                                [styles.script_card_disabled]: !script.enabled,
                            })}
                            key={script.key}
                            layoutId={script.key}
                            data-key={script.key}
                            onClick={script.enabled ? this._focusExample : () => {}}
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
                    <div className={styles.gallery_filters}>{this.renderFeatureFilters()}</div>
                </div>
                <div className={styles.gallery_body}>
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
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withRouter(Examples));
