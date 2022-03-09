//import * as rdt from '@duckdb/react-duckdb-table';

import * as React from 'react';
import * as rd from '@duckdb/react-duckdb';
import * as rdt from '@duckdb/react-duckdb-table';
import * as model from '../../model';
import { CardFrame } from './card_frame';

interface Props {
    card: model.CardSpecification;
    editable?: boolean;
}

export const TableRenderer: React.FC<Props> = (props: Props) => {
    const connection = rd.useDuckDBConnection();
    const connect = rd.useDuckDBConnectionDialer();
    const target = props.card.dataSource?.targetQualified;
    const data = props.card.dataSource;
    React.useEffect(() => {
        if (connection == null) {
            connect();
        }
    }, [connection]);
    if (!data) {
        return <div />;
    }
    return (
        <CardFrame title={props.card.title || target} controls={props.editable}>
            <rdt.TableSchemaProvider name={target}>
                <rdt.WiredTableViewer connection={connection} />
            </rdt.TableSchemaProvider>
        </CardFrame>
    );
};
