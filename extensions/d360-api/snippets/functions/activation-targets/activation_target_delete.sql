/**
 * Remove an activation target. Read it first to be sure it is the destination you mean.
 *
 * The spec doesn't say what happens to activations that still use the target. Use the record id, which starts with `85U`, since one org found names failing.
 */

call d360.activation_target_get (activation_target_id => '85UVF000000Dr4v2AC');

call d360.activation_target_delete (activation_target_id => '85UVF000000Dr4v2AC');
