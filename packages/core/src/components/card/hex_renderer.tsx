import * as React from 'react';
import * as model from '../../model';
import { observeSize } from '../../utils/size_observer';
import { CardFrame } from './card_frame';
import { HexViewer } from './hex_viewer';
import { BlobLoader } from '../blob_loader';

import styles from './hex_renderer.module.css';

interface Props {
    card: model.CardSpecification;
    editable?: boolean;
}

export const HexRenderer: React.FC<Props> = (props: Props) => {
    const planContext = model.usePlanContext();
    const target = props.card.dataSource!.targetQualified;
    const blobID = planContext.blobsByName.get(target)!;
    const blob = planContext.blobs.get(blobID)!;
    console.assert(blob.dataBlob!);

    const containerElement = React.useRef(null);
    const containerSize = observeSize(containerElement);
    return (
        <CardFrame title={props.card.title || target} controls={props.editable}>
            <div ref={containerElement} className={styles.container}>
                {containerSize && (
                    <BlobLoader
                        blob={blob.dataBlob!}
                        loadingComponent={() => <div>loading...</div>}
                        errorComponent={e => <div>Error: {e}</div>}
                    >
                        {buffer => (
                            <HexViewer buffer={buffer} width={containerSize.width} height={containerSize.height} />
                        )}
                    </BlobLoader>
                )}
            </div>
        </CardFrame>
    );
};
