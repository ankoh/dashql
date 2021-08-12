import * as React from 'react';
import * as model from '../../model';
import { AutoSizer } from 'react-virtualized';
import { CardFrame } from './card_frame';
import { HexViewer } from './hex_viewer';
import { BlobLoader } from '../blob_loader';

interface Props {
    card: model.CardSpecification;
    editable?: boolean;
}

export const HexRenderer: React.FC<Props> = (props: Props) => {
    const planContext = model.usePlanContext();
    const target = props.card.dataSource!.targetQualified;
    const blobID = planContext.blobsByName.get(target)!;
    const blob = planContext.blobs.get(blobID)!;
    return (
        <CardFrame title={props.card.title || target} controls={props.editable}>
            <AutoSizer>
                {({ width, height }) => (
                    <BlobLoader
                        blob={blob.blob}
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
