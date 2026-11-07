/**
 * Change the label and description of a data space.
 *
 * The spec requires both, so resend the one you aren't changing. The name, prefix and filter can't be changed with this call.
 */

call cdp.dataspace_update (id_or_name => 'nonDefault', label => 'nonDefault', description => 'Custom data space.');

call cdp.dataspace_get (id_or_name => 'nonDefault');
