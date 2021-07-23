import * as React from 'react';
import * as core from '@dashql/core';
import InputRenderer from './input_renderer';
import TableRenderer from './table_renderer';
import VegaRenderer from './vega_renderer';
import CardStatus from './card_status';

interface Props {
    card: core.model.Card;
    editable?: boolean;
}

export class CardRenderer extends React.Component<Props> {
    public render(): React.ReactElement {
        if (this.props.card.cardRenderer == null) {
            return <CardStatus card={this.props.card} />;
        }
        switch (this.props.card.cardRenderer) {
            case core.model.CardRendererType.BUILTIN_INPUT_TEXT:
            case core.model.CardRendererType.BUILTIN_INPUT_FILE:
                return <InputRenderer card={this.props.card} editable={this.props.editable} />;
            case core.model.CardRendererType.BUILTIN_TABLE:
                return <TableRenderer card={this.props.card} editable={this.props.editable} />;
            case core.model.CardRendererType.BUILTIN_VEGA:
                return <VegaRenderer card={this.props.card} editable={this.props.editable} />;
        }
    }
}

export default CardRenderer;
