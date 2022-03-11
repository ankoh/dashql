import * as React from 'react';
import * as model from '../../model';
import { CardStatus } from './card_status';
import { HexRenderer } from './hex_renderer';
import { JsonRenderer } from './json_renderer';
import { InputTextRenderer } from './input_text_renderer';
import { TableRenderer } from './table_renderer';
import { VegaRenderer } from './vega_renderer';

interface Props {
    card: model.CardSpecification;
    editable?: boolean;
}

export const CardRenderer: React.FunctionComponent<Props> = (props: Props) => {
    if (props.card.cardRenderer == null) {
        return <CardStatus card={props.card} />;
    }
    switch (props.card.cardRenderer) {
        case model.CardRendererType.BUILTIN_INPUT_TEXT:
            return <InputTextRenderer card={props.card} editable={props.editable} />;
        case model.CardRendererType.BUILTIN_TABLE:
            return <TableRenderer card={props.card} editable={props.editable} />;
        case model.CardRendererType.BUILTIN_JSON:
            return <JsonRenderer card={props.card} editable={props.editable} />;
        case model.CardRendererType.BUILTIN_HEX:
            return <HexRenderer card={props.card} editable={props.editable} />;
        case model.CardRendererType.BUILTIN_VEGA:
            return <VegaRenderer card={props.card} editable={props.editable} />;
    }
};
