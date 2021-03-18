import * as React from 'react';
import * as core from '@dashql/core';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { motion, AnimateSharedLayout, AnimatePresence } from 'framer-motion';
import { EXAMPLE_SCRIPTS, EXAMPLE_SCRIPT_MAP, ScriptFeatureTag, ExampleScriptMetadata } from '../examples';

import styles from './examples.module.css';

function ExampleScriptDetail(props: { script: ExampleScriptMetadata; close: () => void }) {
    return (
        <motion.div layoutId={props.script.key}>
            <motion.h5>{props.script.title}</motion.h5>
            <motion.h2>{props.script.description}</motion.h2>
            <motion.button onClick={props.close} />
        </motion.div>
    );
}

function Collection(props: {
    name: string;
    scripts: ExampleScriptMetadata[];
    onClick: React.MouseEventHandler<HTMLDivElement>;
}) {
    return (
        <div>
            <div>{props.name}</div>
            <div>
                {props.scripts.map(script => (
                    <motion.div key={script.key} layoutId={script.key} data-key={script.key} onClick={props.onClick}>
                        <motion.h5>{script.title}</motion.h5>
                        <motion.h2>{script.description}</motion.h2>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}

interface Props {
    className?: string;
}

interface State {
    filteredFeatures: core.utils.NativeBitmap;
    focusedExample: string | null;
}

class Explorer extends React.Component<Props, State> {
    _focusExample = this.focusExample.bind(this);
    _clearFocus = this.clearFocus.bind(this);

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
                <AnimateSharedLayout type="crossfade">
                    {collections.has('collection1') && (
                        <Collection
                            name="collection1"
                            scripts={collections.get('collection1')!}
                            onClick={this._focusExample}
                        />
                    )}
                    <AnimatePresence>
                        {this.state.focusedExample && (
                            <ExampleScriptDetail
                                script={EXAMPLE_SCRIPT_MAP.get(this.state.focusedExample!)!}
                                close={this._clearFocus}
                            />
                        )}
                    </AnimatePresence>
                </AnimateSharedLayout>
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(Explorer);
