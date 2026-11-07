/**
 * Check how many of the org's related-attribute activations are in use, before you create or edit one.
 *
 * Pass the id of the activation you are editing, so that it doesn't count against itself. It returns one row with `current_activations`, `max_activations` and `has_met_limit`.
 */

call cdp.activation_related_attribute_quota_list (activation_id => '85RVF000000CEf72AG');

call cdp.activation_related_attribute_limit_list ();
