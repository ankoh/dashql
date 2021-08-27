import * as React from 'react';
import * as model from '../../model';
import { CardFrame } from './card_frame';
import { JSONViewer } from './json_viewer';
import { BlobLoader } from '../blob_loader';

interface Props {
    card: model.CardSpecification;
    editable?: boolean;
}

export const JsonRenderer: React.FC<Props> = (props: Props) => {
    const planContext = model.usePlanContext();
    const target = props.card.dataSource!.targetQualified;
    const blobID = planContext.blobsByName.get(target)!;
    const blob = planContext.blobs.get(blobID)!;
    console.assert(blob.dataBlob!);
    return (
        <CardFrame title={props.card.title || target} controls={props.editable}>
            <BlobLoader
                blob={blob.dataBlob!}
                loadingComponent={() => <div>loading...</div>}
                errorComponent={e => <div>Error: {e}</div>}
            >
                {buffer => <JSONViewer buffer={buffer} />}
            </BlobLoader>
        </CardFrame>
    );
};
