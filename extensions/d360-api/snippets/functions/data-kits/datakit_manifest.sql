/**
 * List all member components of a kit and what they depend on.
 *
 * The path is `/ssot/datakit/` and not `/data-kits/`, and a healthy org can still answer `NOT_FOUND`. `entity_name` in the rows names a metadata type such as `DataPackageKitObject`.
 */

call cdp.datakit_list (namespace => 'acme');

call cdp.datakit_manifest (data_kit_dev_name => 'Customer_Kit');
