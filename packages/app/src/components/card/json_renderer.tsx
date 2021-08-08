import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../../model';
import { useSelector } from 'react-redux';
import { CardFrame } from './card_frame';
import { JSONViewer } from './json_viewer';
import { BlobLoader } from '../blob_loader';

interface Props {
    card: core.model.CardSpecification;
    editable?: boolean;
}

export const JsonRenderer: React.FC<Props> = (props: Props) => {
    const planState = useSelector((state: model.AppState) => state.core.planState);
    const target = props.card.dataSource!.targetQualified;
    const obj = core.model.resolveBlobByName(planState, target)!;
    return (
        <CardFrame title={props.card.title || target} controls={props.editable}>
            <BlobLoader
                blob={obj.blob}
                loadingComponent={() => <div>loading...</div>}
                errorComponent={e => <div>Error: {e}</div>}
            >
                {buffer => <JSONViewer buffer={buffer} />}
            </BlobLoader>
        </CardFrame>
    );
};
