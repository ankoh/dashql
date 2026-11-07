/**
 * Detach a capping activation target from its dimension values. Read the mapping first to see what you are removing.
 *
 * The sources don't say whether segments already activated through the target are affected.
 */

call cdp.communication_capping_activation_target_metadata_get (activation_target_id => '85UVF000000Dr4v2AC');

call cdp.communication_capping_activation_target_metadata_delete (activation_target_id => '85UVF000000Dr4v2AC');
