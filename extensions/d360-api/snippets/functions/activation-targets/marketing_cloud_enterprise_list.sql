/**
 * List the Marketing Cloud enterprises and their business units, to fill the business unit of a Marketing Cloud target.
 *
 * The id of a business unit is described as the MID, but the sample shows a record id with the numeric MID only in the name. Page with `offset` and `batch_size`.
 */

call cdp.marketing_cloud_enterprise_list (batch_size => 50, offset => 0);
