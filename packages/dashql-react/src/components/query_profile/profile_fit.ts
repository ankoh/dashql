/** The padding between the viewport and the fitted plan */
export const PROFILE_FIT_PADDING = 24;
/** The padding at the bottom of the viewport, which also clears the controls in the bottom corners */
export const PROFILE_FIT_PADDING_BOTTOM = 44;

/** The bounds of the drawn plan in scene coordinates */
export interface ProfileFitBounds {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface ProfileFitTransform {
    x: number;
    y: number;
    scale: number;
}

/**
 * Compute the transform that shows a plan as a whole in a viewport.
 *
 * The bounds are those of the drawn plan, which need not start at the origin of the scene. The plan is scaled down
 * until it fits (but never enlarged beyond scale 1) and centered in the space left by the paddings. Large plans
 * shrink as far as needed, zooming in is up to the user.
 */
export function computeProfileFitTransform(
    bounds: ProfileFitBounds,
    viewportWidth: number,
    viewportHeight: number,
): ProfileFitTransform {
    const availableWidth = Math.max(1, viewportWidth - PROFILE_FIT_PADDING * 2);
    const availableHeight = Math.max(1, viewportHeight - PROFILE_FIT_PADDING - PROFILE_FIT_PADDING_BOTTOM);
    const scale = Math.min(1, availableWidth / bounds.width, availableHeight / bounds.height);
    return {
        x: PROFILE_FIT_PADDING + (availableWidth - bounds.width * scale) / 2 - bounds.left * scale,
        y: PROFILE_FIT_PADDING + (availableHeight - bounds.height * scale) / 2 - bounds.top * scale,
        scale,
    };
}
