/**
 * Stop a target from receiving activations. Read it first, so that you know what you are switching off.
 *
 * It takes the 18-character record id. The spec doesn't say what happens to activations that use the target. Read `success` in the result.
 */

call cdp.activation_target_get (activation_target_id => '85UVF000000Dr4v2AC');

call cdp.activation_target_disable (activation_target_id => '85UVF000000Dr4v2AC', dataspace => 'default');
