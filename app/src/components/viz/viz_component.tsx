import * as React from 'react';
import * as core from '@dashql/core';
import TableRenderer from  './table_renderer';
import VegaRenderer from  './vega_renderer';

interface Props {
    vizInfo: core.model.VizInfo;
    editable?: boolean;
}

export class VizComponent extends React.Component<Props> {
    public render() {
        switch (this.props.vizInfo.renderer) {
            case core.model.VizRendererType.BUILTIN_TABLE:
                return <TableRenderer vizInfo={this.props.vizInfo} editable={this.props.editable} />;
            case core.model.VizRendererType.BUILTIN_VEGA:
                return <VegaRenderer vizInfo={this.props.vizInfo} editable={this.props.editable} />;
            
        }
    }
}

export default VizComponent;
