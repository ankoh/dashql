/**
 * Step 1 of communication capping.
 *
 * Cap by channel. The `id` in the result is `:dimension_id`, and `:dimension_value_id` comes from its `dimension_values`.
 */

CALL cdp.communication_capping_dimension_create (api_name => 'Channel', dimension_name => 'ssot__CommunicationChannel__dlm', hierarchy_order => 1, dimension_values => [(value = 'Email')]);
