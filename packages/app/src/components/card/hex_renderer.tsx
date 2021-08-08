import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../../model';
import { AutoSizer } from 'react-virtualized';
import { useSelector } from 'react-redux';
import { CardFrame } from './card_frame';
import { HexViewer } from './hex_viewer';
import { BlobLoader } from '../blob_loader';

interface Props {
    card: core.model.CardSpecification;
    editable?: boolean;
}

export const HexRenderer: React.FC<Props> = (props: Props) => {
    const planState = useSelector((state: model.AppState) => state.core.planState);
    const target = props.card.dataSource!.targetQualified;
    const obj = core.model.resolveBlobByName(planState, target)!;
    return (
        <CardFrame title={props.card.title || target} controls={props.editable}>
            <AutoSizer>
                {({ width, height }) => (
                    <BlobLoader
                        blob={obj.blob}
                        loadingComponent={() => <div>loading...</div>}
                        errorComponent={e => <div>Error: {e}</div>}
                    >
                        {buffer => <HexViewer buffer={buffer} width={width} height={height} />}
                    </BlobLoader>
                )}
            </AutoSizer>
        </CardFrame>
    );
};
