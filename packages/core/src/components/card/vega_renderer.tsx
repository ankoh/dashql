import * as React from 'react';
import * as model from '../../model';
import * as access from '../../access';
import * as rd from '@duckdb/react-duckdb';
import { Table } from 'apache-arrow/table';
import { withAutoSizer } from '../../utils/autosizer';
import { Vega } from 'react-vega';
import { CardFrame } from './card_frame';

interface VegaRendererProps {
    card: model.CardSpecification;
    editable?: boolean;
}

interface VegaWithRowsProps {
    data: Table;
    width: number;
    height: number;
    vegaSpec: any;
}

const VegaWithRows: React.FC<VegaWithRowsProps> = (props: VegaWithRowsProps) => {
    const rows = React.useMemo(() => access.tableToJSON(props.data), [props.data]);
    return (
        <Vega
            style={{
                width: props.width,
                height: props.height,
            }}
            spec={props.vegaSpec as any}
            data={{ source: rows }}
            width={props.width}
            height={props.height}
            actions={false}
        />
    );
};

type ContentProps = VegaRendererProps & { table: model.TableMetadata; width: number; height: number };

const ContentRenderer: React.FC<ContentProps> = (props: ContentProps) => {
    const db = rd.useDuckDB();
    const conn = rd.useDuckDBConnection();
    const connDialer = rd.useDuckDBConnectionDialer();

    React.useEffect(() => {
        if (db == null) {
            return;
        } else if (conn == null && connDialer != null) {
            connDialer();
        }
    }, [db, conn, connDialer]);
    if (conn == null) return <div />;

    if (props.width == 0 && props.height == 0) return <div />;
    console.assert(!!props.card.dataSource);

    switch (props.card.dataSource!.dataResolver) {
        case model.CardDataResolver.AM4: {
            return (
                <access.AM4Provider
                    connection={conn}
                    table={props.table}
                    data={props.card.dataSource!}
                    width={props.width}
                >
                    {result => (
                        <VegaWithRows
                            data={result}
                            width={props.width}
                            height={props.height}
                            vegaSpec={props.card.vegaSpec}
                        />
                    )}
                </access.AM4Provider>
            );
        }

        case model.CardDataResolver.RESERVOIR_SAMPLE: {
            return (
                <access.SampleProvider connection={conn} table={props.table} data={props.card.dataSource!}>
                    {result => (
                        <VegaWithRows
                            data={result}
                            width={props.width}
                            height={props.height}
                            vegaSpec={props.card.vegaSpec}
                        />
                    )}
                </access.SampleProvider>
            );
        }

        default:
            return <div />;
    }
};
const ContentRendererWithSize = withAutoSizer(ContentRenderer);

export const VegaRenderer: React.FC<VegaRendererProps> = (props: VegaRendererProps) => {
    const dbMeta = model.useDatabaseMetadata();
    const target = props.card.dataSource!.targetQualified;
    const table = dbMeta.tables.get(target);
    if (!table) {
        return <div />;
    }
    return (
        <CardFrame title={props.card.title || target} controls={props.editable}>
            <ContentRendererWithSize {...props} table={table} />
        </CardFrame>
    );
};
