import * as React from "react";
import * as core from "@dashql/core";
import { connect } from 'react-redux';
import { AppState, AppStateMutations, Dispatch } from '../store';
import classnames from 'classnames';

import parser = core.parser;
import styles from './module_inspector.module.css';

interface Props {
    module: core.parser.Module | null;
    className?: string
}

class ModuleInspector extends React.Component<Props> {
    public render() {
        if (this.props.module == null) {
            return <div />;
        }

        const mod = this.props.module;
        const node_count = mod.buffer.nodesLength();
        const node_children: JSX.Element[][] = [];
        while (node_children.length < node_count) {
            node_children.push([]);
        }

        const statements: JSX.Element[] = [];

        mod.iterateStatements((idx: number, stmt: parser.Statement): void => {
            const preorder = (_node_id: number, node: parser.Node): void => {
                console.log(node.key);
            };

            const postorder = (node_id: number, node: parser.Node): void => {
                console.log(node.key);
                node_children[node.parent].push(
                    <div className={styles.node}>
                        <div className={styles.node_key}>
                            {node.key}
                        </div>
                        <div className={styles.node_children}>
                            {node_children[node_id]}
                        </div>
                    </div>
                );
            };
            stmt.traverse(preorder, postorder);
            // statements.push(node_children[stmt.root()][0]);
        });

        return (
            <div className={classnames(this.props.className, styles.inspector)}>
                {statements}
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    module: state.editorModule
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({
});

export default connect(mapStateToProps, mapDispatchToProps)(ModuleInspector);
