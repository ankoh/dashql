/**
 * Read one activation in full: its segment, target, attributes, contact points and filters.
 *
 * Check `last_publish_status` and `last_publish_status_error_msg` to see how the last publish went. The output has a different shape than the input of `activation_create`, so it can't be sent back as it is.
 */

call cdp.activation_list (filters => 'name in high_value_s3', batch_size => 20);

call cdp.activation_get (activation_id => '85RVF000000CEf72AG');
