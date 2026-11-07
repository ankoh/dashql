/**
 * Swap the hierarchy order of two dimensions, here so that Brand comes before Channel.
 *
 * Send the `id` and the new `hierarchy_order` of each. The result has the full dimensions. The sources don't explain how the order affects evaluation.
 */

call cdp.communication_capping_dimension_list ();

call cdp.communication_capping_dimension_priority_update (
    dimensions => [(id = '1CDxx0000000002GAA', hierarchy_order = 1), (id = '1CDxx0000000001GAA', hierarchy_order = 2)]
);
