import * as React from 'react';
import * as arrow from 'apache-arrow';
import * as model from '../../model';
import * as access from '../../access';
import { withAutoSizer } from '../../utils/autosizer';
import { Vega } from 'react-vega';
import { CardFrame } from './card_frame';

interface VegaRendererProps {
    card: model.CardSpecification;
    editable?: boolean;
}

interface VegaWithRowsProps {
    data: arrow.Table;
    width: number;
    height: number;
    vegaSpec: any;
}

const VegaWithRows: React.FC<VegaWithRowsProps> = (props: VegaWithRowsProps) => {
    const rows = React.useMemo(() => props.data.toArray(), [props.data]);
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
    if (props.width == 0 && props.height == 0) return <div />;
    console.assert(!!props.card.dataSource);

    switch (props.card.dataSource!.dataResolver) {
        case model.CardDataResolver.M5: {
            return (
                <access.M5Provider table={props.table} data={props.card.dataSource!} width={props.width}>
                    {result => (
                        <VegaWithRows
                            data={result}
                            width={props.width}
                            height={props.height}
                            vegaSpec={props.card.vegaSpec}
                        />
                    )}
                </access.M5Provider>
            );
        }

        case model.CardDataResolver.RESERVOIR_SAMPLE: {
            return (
                <access.SampleProvider table={props.table} data={props.card.dataSource!}>
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
