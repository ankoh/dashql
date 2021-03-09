import * as React from 'react';
import * as core from '@dashql/core';
import TableRenderer from  './table_renderer';
import VictoryRendererClustered from  './victory_renderer_clustered';
import VictoryRendererSimple from  './victory_renderer_simple';

interface Props {
    vizInfo: core.model.VizInfo;
}

export class VizComponent extends React.Component<Props> {
    public render() {
        switch (this.props.vizInfo.renderer) {
            case core.model.VizRendererType.BUILTIN_TABLE:
                return <TableRenderer vizInfo={this.props.vizInfo} />;
            case core.model.VizRendererType.BUILTIN_VICTORY_CLUSTERED:
                return <VictoryRendererClustered vizInfo={this.props.vizInfo} />;
            case core.model.VizRendererType.BUILTIN_VICTORY_SIMPLE:
                return <VictoryRendererSimple vizInfo={this.props.vizInfo} />;
            
        }
    }
}

export default VizComponent;
