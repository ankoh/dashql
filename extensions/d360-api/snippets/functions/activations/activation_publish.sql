/**
 * Run a Batch DMO activation now instead of waiting for its schedule, as a full or an incremental publish.
 *
 * Whether `full_refresh` is honored depends on how the DMO is configured. Read `success` in the result, then poll `last_publish_status` of the activation, which comes in upper case (`SUCCESS`) in the samples.
 */

call cdp.activation_publish (activation_id => '85RVF000000CEf72AG', full_refresh => true);

call cdp.activation_get (activation_id => '85RVF000000CEf72AG');
