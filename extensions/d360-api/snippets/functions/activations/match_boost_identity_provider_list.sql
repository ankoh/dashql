/**
 * List the identity providers that can augment the contact points of an activation target, to see which one to use for match boost.
 *
 * `selected_provider_id` is for edit mode only, to mark the provider saved earlier. `supported_contact_points` shows which contact point types a provider can augment.
 */

call cdp.match_boost_identity_provider_list (
    activate_on => 'ssot__Individual__dlm',
    activation_target_id => '85UVF000000Dr4v2AC',
    dataspace => 'default',
    selected_provider_id => '0PBVF000000Ab12'
);
