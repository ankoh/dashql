/**
 * Create a dimension and its possible values, here Channel with Email and SMS. Do it first, since configurations, rules and mappings refer to its ids.
 *
 * There is no idempotency documented, so don't retry this blindly. The reference's samples use hierarchy order 1 for Channel and 2 for Brand.
 */

call cdp.communication_capping_dimension_create (
    api_name => 'Channel',
    name => 'Channel',
    dimension_name => 'ssot__CommunicationChannel__dlm',
    function_type => 'NON_FUNCTIONAL_TYPE',
    hierarchy_order => 1,
    dimension_values => [(value = 'Email'), (value = 'SMS')]
);
