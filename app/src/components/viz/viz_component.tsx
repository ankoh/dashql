import * as React from 'react';
import * as core from '@dashql/core';
import TableRenderer from  './table_renderer';
import VictoryRenderer from  './victory_renderer';

interface Props {
    vizInfo: core.model.VizInfo;
}

enum VizRenderer {
    VICTORY,
    TABLE,
}

export class VizComponent extends React.Component<Props> {
    public render() {
        let renderer: VizRenderer | null = null;
        const spec = this.props.vizInfo.spec;

        for (const c of spec.components) {
            switch (c.type) {
                case core.proto.syntax.VizComponentType.AREA:
                case core.proto.syntax.VizComponentType.AXIS:
                case core.proto.syntax.VizComponentType.BAR:
                case core.proto.syntax.VizComponentType.BOX_PLOT:
                case core.proto.syntax.VizComponentType.CANDLESTICK:
                case core.proto.syntax.VizComponentType.ERROR_BAR:
                case core.proto.syntax.VizComponentType.HISTOGRAM:
                case core.proto.syntax.VizComponentType.LINE:
                case core.proto.syntax.VizComponentType.PIE:
                case core.proto.syntax.VizComponentType.SCATTER:
                case core.proto.syntax.VizComponentType.VORONOI:
                    if (renderer == null) {
                        renderer = VizRenderer.VICTORY;
                    }
                    break;

                case core.proto.syntax.VizComponentType.TABLE:
                    renderer = VizRenderer.TABLE;
                    break;

                case core.proto.syntax.VizComponentType.NUMBER:
                case core.proto.syntax.VizComponentType.TEXT:
                    break;
            }
        }
        if (renderer == null) {
            return <div />;
        }
        switch (renderer) {
            case VizRenderer.TABLE:
                return <TableRenderer targetQualified="global.foo" />;
            case VizRenderer.VICTORY:
                return <VictoryRenderer vizInfo={this.props.vizInfo} />;
            
        }
    }
}

export default VizComponent;
