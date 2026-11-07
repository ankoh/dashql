/**
 * Test a saved connection and let the result update its status. Reach for it after a credential was rotated or a network route changed.
 *
 * This writes the status. Check `success` and `errors` in the result, `success` says the test was initiated.
 */

call cdp.existing_connection_action_test (connection_id => '9cgaj0000012O5hAAE');

call cdp.connection_get (connection_id => '9cgaj0000012O5hAAE');
