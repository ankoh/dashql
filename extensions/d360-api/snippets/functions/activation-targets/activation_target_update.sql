/**
 * Change the name, description or capping of an activation target.
 *
 * It is a `PATCH`, but `name` and `dataspace_name` are required, so send both. Use `activation_target_enable` and `activation_target_disable` to switch it on or off. Read the target afterwards to check.
 */

call cdp.activation_target_update (
    activation_target_id => '85UVF000000Dr4v2AC',
    dataspace_name => 'default',
    name => 's3_target2',
    description => 'Nightly audience exports',
    is_capping_enabled => true
);

call cdp.activation_target_get (activation_target_id => '85UVF000000Dr4v2AC');
