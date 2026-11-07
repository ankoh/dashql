/**
 * Audit which activation targets a capping configuration governs, one row per mapping with its dimension and value.
 *
 * The response has no total or next-page field, so a short page is the only sign of the end. Page with `limit` and `offset`.
 */

call cdp.communication_capping_activation_target_list (
    id => '1CCxx0000004C92AAE',
    limit => 50,
    offset => 0,
    order_by_column => 'Name',
    order_by_direction => 'ASC'
);
