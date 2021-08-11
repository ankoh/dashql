import * as React from 'react';
import * as core from '@dashql/core';
import { CardFrame } from './card_frame';
import { JSONViewer } from './json_viewer';
import { BlobLoader } from '../blob_loader';

interface Props {
    card: core.model.CardSpecification;
    editable?: boolean;
}

export const JsonRenderer: React.FC<Props> = (props: Props) => {
    const planContext = core.model.usePlanContext();
    const target = props.card.dataSource!.targetQualified;
    const blobID = planContext.blobsByName.get(target)!;
    const blob = planContext.blobs.get(blobID)!;
    return (
        <CardFrame title={props.card.title || target} controls={props.editable}>
            <BlobLoader
                blob={blob.blob}
                loadingComponent={() => <div>loading...</div>}
                errorComponent={e => <div>Error: {e}</div>}
            >
                {buffer => <JSONViewer buffer={buffer} />}
            </BlobLoader>
        </CardFrame>
    );
};
