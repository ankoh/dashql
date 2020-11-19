import * as React from "react";
import * as core from "@dashql/core";
import { connect } from 'react-redux';
import { AppState, Dispatch } from '../store';
import classnames from 'classnames';

import sx = core.proto.syntax;
import parser = core.parser;
import styles from './program_graph.module.css';

interface Props {
    program: core.parser.Program | null;
    className?: string
}

class ProgramGraph extends React.Component<Props> {
    /// SVG dom node
    private svgNode = React.createRef<SVGSVGElement>();
    /// SVG group dom node
    private svgGroupNode = React.createRef<SVGSVGElement>();

    public render() {
        return (
            <div className={classnames(this.props.className)}>
                <svg ref={this.svgNode}>
                    <g ref={this.svgGroupNode} />
                </svg>
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    program: state.editorProgram
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({
});

export default connect(mapStateToProps, mapDispatchToProps)(ProgramGraph);
