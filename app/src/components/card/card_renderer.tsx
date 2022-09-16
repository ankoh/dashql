import * as React from 'react';
import { CardStatus } from './card_status';

interface Props {
    statementId: number;
    editable?: boolean;
}

export const CardRenderer: React.FunctionComponent<Props> = (props: Props) => {
    return <CardStatus statementId={props.statementId} />;
};
