import * as React from 'react';
import * as core from '@dashql/core';
import classNames from 'classnames';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { motion, AnimateSharedLayout, AnimatePresence } from 'framer-motion';
import { EXAMPLE_SCRIPTS, EXAMPLE_SCRIPT_MAP, ScriptFeatureTag, ExampleScriptMetadata } from '../examples';

import styles from './examples.module.css';

interface Props {
    className?: string;
}

interface State {
    filteredFeatures: core.utils.NativeBitmap;
    focusedExample: string | null;
}

function getFeatureTagLabel(tag: ScriptFeatureTag) {
    switch (tag) {
        case ScriptFeatureTag.EXTRACT_CSV:
            return 'EXTRACT CSV';
        case ScriptFeatureTag.EXTRACT_JSON:
            return 'EXTRACT JSON';
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
            filteredFeatures: this.state.filteredFeatures.clearAll(),
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
            <motion.div layoutId={script.key}>
                <motion.h5>{script.title}</motion.h5>
                <motion.h2>{script.description}</motion.h2>
                <motion.button onClick={this._clearFocus} />
            </motion.div>
        );
    }

    renderCollection(name: string, scripts: ExampleScriptMetadata[]) {
        return (
            <div className={styles.collection}>
                <div className={styles.collection_name}>{name}</div>
                <div className={styles.collection_grid}>
                    {scripts.map(script => (
                        <motion.div
                            key={script.key}
                            layoutId={script.key}
                            data-key={script.key}
                            onClick={this._focusExample}
                        >
                            <motion.h5>{script.title}</motion.h5>
                            <motion.h2>{script.description}</motion.h2>
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
            <div className={styles.explorer}>
                {this.renderFeatureFilters()}
                <AnimateSharedLayout type="crossfade">
                    {collections.has('collection1') &&
                        this.renderCollection('collection1', collections.get('collection1')!)}
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
