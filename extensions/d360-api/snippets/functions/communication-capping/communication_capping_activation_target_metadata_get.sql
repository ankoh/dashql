/**
 * See the dimensions and values mapped to a capping activation target, to compare them with the rule it should match.
 *
 * The mapping comes from `communication_capping_activation_target_metadata_map`.
 */

call cdp.communication_capping_activation_target_metadata_get (activation_target_id => '85UVF000000Dr4v2AC');

call cdp.communication_capping_rule_list (id => '1CCxx0000004C92AAE', limit => 50);
