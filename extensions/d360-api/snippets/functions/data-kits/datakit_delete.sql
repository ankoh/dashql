/**
 * Delete a data kit from the org.
 *
 * Read it first to be sure it's the right kit. A second delete fails with `INTERNAL_SERVER_ERROR: PackageKitDefinition does not exist`, which means the kit is already gone. The docs don't say whether deleting a kit affects components already deployed from it.
 */

call d360.datakit_get (data_kit_dev_name => 'Customer_Kit');

call d360.datakit_delete (data_kit_dev_name => 'Customer_Kit');
