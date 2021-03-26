import * as React from 'react';
import * as core from '@dashql/core';
import TableRenderer from './table_renderer';
import VegaRenderer from './vega_renderer';
import VizProgress from './viz_progress';
import { VizCard } from './viz_card';

interface Props {
    vizInfo: core.model.VizInfo;
    editable?: boolean;
}

export class VizComponent extends React.Component<Props> {
    public renderViz() {
        if (this.props.vizInfo.renderer == null) {
            return <VizProgress vizInfo={this.props.vizInfo} />;
        }
        switch (this.props.vizInfo.renderer) {
            case core.model.VizRendererType.BUILTIN_TABLE:
                return <TableRenderer vizInfo={this.props.vizInfo} editable={this.props.editable} />;
            case core.model.VizRendererType.BUILTIN_VEGA:
                return <VegaRenderer vizInfo={this.props.vizInfo} editable={this.props.editable} />;
        }
    }

    public render() {
        return (
            <VizCard title={this.props.vizInfo.title || 'Some Title'} controls={this.props.editable}>
                {this.renderViz()}
            </VizCard>
        );
    }
}

export default VizComponent;
