/**
 * Switch a platform off. Read it first to see its state.
 *
 * The spec doesn't say what this does to existing targets and activations.
 */

call d360.activation_platform_get (id_or_name => 'abc_user_identifiers');

call d360.activation_platform_disable (id_or_name => 'abc_user_identifiers');
