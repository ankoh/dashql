import * as React from 'react';
import * as core from '@dashql/core';
import TableRenderer from './table_renderer';
import VegaRenderer from './vega_renderer';
import ProgressGraph from './progress_graph';
import { CardFrame } from './card_frame';

interface Props {
    card: core.model.Card;
    editable?: boolean;
}

export class VizComponent extends React.Component<Props> {
    public renderViz() {
        if (this.props.card.cardRenderer == null) {
            return <ProgressGraph card={this.props.card} />;
        }
        switch (this.props.card.cardRenderer) {
            case core.model.CardRendererType.BUILTIN_TABLE:
                return <TableRenderer card={this.props.card} editable={this.props.editable} />;
            case core.model.CardRendererType.BUILTIN_VEGA:
                return <VegaRenderer card={this.props.card} editable={this.props.editable} />;
        }
    }

    public render() {
        return (
            <CardFrame title={this.props.card.title || 'Some Title'} controls={this.props.editable}>
                {this.renderViz()}
            </CardFrame>
        );
    }
}

export default VizComponent;
