import * as dashql from '@ankoh/dashql-core';
import { PROFILE_OPERATOR_SYMBOL_SIZE } from './profile_operator_symbol.js';

/// The width of the annotation slot at the left of every operator: the status icon, the row count or the estimate.
/// A row count like `7.53M` fills it.
export const PROFILE_OPERATOR_ANNOTATION_WIDTH = 34;

/// The layout config of rendered query profiles. Every operator reserves the annotation slot left of its label.
///
/// A plan grows top-down by default. A left-to-right plan fits wide and short viewports like the query progress of
/// the feed: its height grows with the inputs of the operators, not with the depth of the plan.
///
/// The plan is dense. The row counts sit in the annotation slots of the operators, the gaps between the operators only
/// hold the edges and the fragment contours, which pad the operators by 8 pixels.
export function createProfileLayoutConfig(
    orientation = dashql.buffers.profile.ProfileLayoutOrientation.TOP_DOWN,
): dashql.buffers.profile.ProfileLayoutConfigT {
    const leftToRight = orientation === dashql.buffers.profile.ProfileLayoutOrientation.LEFT_TO_RIGHT;
    const config = new dashql.buffers.profile.ProfileLayoutConfigT();
    config.levelHeight = 56;
    config.nodeHeight = 32;
    config.nodeMarginHorizontal = leftToRight ? 32 : 28;
    config.nodeMarginVertical = 40;
    config.nodePaddingLeft = 12;
    config.nodePaddingRight = 12;
    config.iconWidth = PROFILE_OPERATOR_ANNOTATION_WIDTH;
    config.iconMarginRight = 8;
    config.maxLabelChars = 20;
    config.widthPerLabelChar = 8.5;
    config.nodeMinWidth = 0;
    // An operator without a label of its own is as narrow as the symbol of its kind
    config.symbolWidth = PROFILE_OPERATOR_SYMBOL_SIZE;
    config.orientation = orientation;
    return config;
}

/// The other orientation of a plan, rotating a plan lays it out again with it
export function rotateProfileLayoutOrientation(
    orientation: dashql.buffers.profile.ProfileLayoutOrientation,
): dashql.buffers.profile.ProfileLayoutOrientation {
    const { LEFT_TO_RIGHT, TOP_DOWN } = dashql.buffers.profile.ProfileLayoutOrientation;
    return orientation === LEFT_TO_RIGHT ? TOP_DOWN : LEFT_TO_RIGHT;
}

/// The layout config of the query progress. The progress shows the plan in short panels, the plan grows left-to-right.
export function createProgressLayoutConfig(): dashql.buffers.profile.ProfileLayoutConfigT {
    return createProfileLayoutConfig(dashql.buffers.profile.ProfileLayoutOrientation.LEFT_TO_RIGHT);
}
