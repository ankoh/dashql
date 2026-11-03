import * as dashql from '@ankoh/dashql-core';

/// The layout config of rendered query profiles. With progress, the nodes reserve room for a status icon.
export function createProfileLayoutConfig(showProgress: boolean): dashql.buffers.profile.ProfileLayoutConfigT {
    const config = new dashql.buffers.profile.ProfileLayoutConfigT();
    config.levelHeight = 72;
    config.nodeHeight = 32;
    config.nodeMarginHorizontal = 32;
    config.nodePaddingLeft = 12;
    config.nodePaddingRight = 12;
    config.iconWidth = showProgress ? 14 : 0;
    config.iconMarginRight = showProgress ? 8 : 0;
    config.maxLabelChars = 20;
    config.widthPerLabelChar = 8.5;
    config.nodeMinWidth = 0;
    return config;
}
