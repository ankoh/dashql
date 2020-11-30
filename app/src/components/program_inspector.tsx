import * as React from "react";
import * as core from "@dashql/core";
import { connect } from 'react-redux';
import { AppState, Dispatch } from '../store';
import classnames from 'classnames';

import sx = core.proto.syntax;
import parser = core.parser;
import styles from './program_inspector.module.css';

interface Props {
    program: core.parser.Program | null;
    className?: string
}

class ProgramInspector extends React.Component<Props> {
    public render() {
        if (this.props.program == null) {
            return <div />;
        }

        const program = this.props.program;
        const node_count = program.proto.nodesLength();
        const node_children: JSX.Element[][] = [];
        while (node_children.length < node_count) {
            node_children.push([]);
        }

        const statements: JSX.Element[] = [];

        program.iterateStatements((_idx: number, stmt: parser.Statement): void => {
            stmt.traverse(
                (_node_id: number, _node: parser.Node, _path: parser.NodePath): void => {},
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
    program: state.studioProgram
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({
});

export default connect(mapStateToProps, mapDispatchToProps)(ProgramInspector);
