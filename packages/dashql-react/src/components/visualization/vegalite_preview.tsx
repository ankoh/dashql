import * as React from 'react';

import * as styles from './vegalite_preview.module.css';
import { createVegaLitePreviewConfig } from '../../vegalite/vegalite_theme.js';
import { VegaLiteView, type VegaLiteViewProps } from '../vegalite_view.js';

/// The inset of the chart in its box, the padding of the preview style
export const VEGALITE_PREVIEW_INSET = 8;

export type VegaLitePreviewProps = Omit<VegaLiteViewProps, 'width' | 'height' | 'hideLegend' | 'config' | 'className'> & {
    /// The size of the box of the preview, the chart fits into it with its inset
    width: number;
    height: number;
};

/// A chart in a small box, e.g. on the dataflow canvas: the preview config with smaller text and marks, no legends,
/// and the whole plot fitted into the box
export function VegaLitePreview({ width, height, ...props }: VegaLitePreviewProps): React.ReactElement {
    return (
        <VegaLiteView
            {...props}
            width={Math.max(0, width - 2 * VEGALITE_PREVIEW_INSET)}
            height={Math.max(0, height - 2 * VEGALITE_PREVIEW_INSET)}
            config={createVegaLitePreviewConfig}
            className={styles.preview}
            hideLegend
        />
    );
}
