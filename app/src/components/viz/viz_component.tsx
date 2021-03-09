import * as React from 'react';
import * as core from '@dashql/core';
import TableRenderer from  './table_renderer';
import VictoryRendererGrouped from  './victory_renderer_grouped';
import VictoryRendererSimple from  './victory_renderer_simple';

interface Props {
    vizInfo: core.model.VizInfo;
}

export class VizComponent extends React.Component<Props> {
    public render() {
        switch (this.props.vizInfo.renderer) {
            case core.model.VizRendererType.BUILTIN_TABLE:
                return <TableRenderer vizInfo={this.props.vizInfo} />;
            case core.model.VizRendererType.BUILTIN_VICTORY_GROUPED:
                return <VictoryRendererGrouped vizInfo={this.props.vizInfo} />;
            case core.model.VizRendererType.BUILTIN_VICTORY_SIMPLE:
                return <VictoryRendererSimple vizInfo={this.props.vizInfo} />;
            
        }
    }
}

export default VizComponent;
