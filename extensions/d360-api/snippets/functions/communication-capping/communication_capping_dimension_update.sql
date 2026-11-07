/**
 * Add a value to a capping dimension, here WhatsApp for the Channel dimension.
 *
 * The sources don't say whether `dimension_values` replaces the existing values or adds to them. Rules and mappings refer to value ids, so check them before removing a value.
 */

call cdp.communication_capping_dimension_list ();

call cdp.communication_capping_dimension_update (
    dimension_id => '1CDxx0000000001GAA',
    api_name => 'Channel',
    dimension_name => 'ssot__CommunicationChannel__dlm',
    hierarchy_order => 1,
    dimension_values => [(value = 'Email'), (value = 'SMS'), (value = 'WhatsApp')]
);
