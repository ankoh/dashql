/**
 * List the capping dimensions with their values and hierarchy order, to find the dimension and value ids that rules and target mappings need.
 *
 * The call has no paging options. `dimension_values` comes back as JSON, with the ids of the values inside.
 */

call cdp.communication_capping_dimension_list ();

call cdp.communication_capping_dimension_update (
    dimension_id => '1CDxx0000000001GAA',
    dimension_values => [(value = 'WhatsApp')]
);
