/**
 * List the data kits of one package namespace.
 *
 * Use it to find the developer name of a kit. The call can take over a minute or fail on orgs with many kits, and a new kit may not show up right away.
 */

call d360.datakit_list (namespace => 'acme');

call d360.datakit_manifest (data_kit_dev_name => 'Customer_Kit');
