/**
 * Retry the sync of a market segment activation whose last publish ended in an error.
 *
 * No source says what a retry resends or in which states it is allowed. Read `last_publish_status` and `last_publish_status_error_msg` before and after.
 */

call cdp.activation_get (activation_id => '85RVF000000CEf72AG');

call cdp.activation_sync_retry (activation_id => '85RVF000000CEf72AG');

call cdp.activation_history_list (activation_id => '85RVF000000CEf72AG', limit => 5);
