/**
 * Send the whole audience of a market segment activation again, not only the changes since the last publish.
 *
 * No job id comes back and no status is documented for it, so look at `last_publish_status` of the activation and at the publish history. DMO activations use `activation_publish` with `full_refresh` instead.
 */

call d360.activation_full_refresh_run (activation_id => '85RVF000000CEf72AG');

call d360.activation_history_list (activation_id => '85RVF000000CEf72AG', limit => 5);
