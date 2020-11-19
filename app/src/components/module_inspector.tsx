import * as React from "react";
import * as core from "@dashql/core";
import { connect } from 'react-redux';
import { AppState, AppStateMutations, Dispatch } from '../store';
import classnames from 'classnames';

import sx = core.proto.syntax;
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

        mod.iterateStatements((_idx: number, stmt: parser.Statement): void => {
            stmt.traverse(
                (_node_id: number, _node: parser.Node): void => {},
                (node_id: number, node: parser.Node): void => {
                const elem = (
                    <div key={node_id} className={styles.node}>
                        <div className={styles.node_key}>
                            {sx.AttributeKey[node.key]}
                        </div>
                        <div className={styles.node_children}>
                            {node_children[node_id]}
                        </div>
                    </div>
                );
                node_children[node_id] = [];
                if (node_id == stmt.root) {
                    statements.push(elem);
                } else {
                    node_children[node.parent].push(elem);
                }
            });
        });
        console.log(statements);

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
