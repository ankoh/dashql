/**
 * Create a custom data space with a label, a prefix and a description.
 *
 * The spec contradicts itself on the body: its schema lists `id`, `name`, `namespace` and `filter`, while its example and the Postman collection send the three options used here. Read the space until `status` is `Active`, `Error` means it failed.
 */

call cdp.dataspace_create (label => 'nonDefault', prefix => 'ndf', description => 'Custom data space.');

call cdp.dataspace_get (id_or_name => 'nonDefault');
