/**
 * Step 1 of the order pipeline: from Snowflake orders to an activated audience.
 *
 * Find the data space to work in. The steps below use `default`.
 */

call cdp.dataspace_list ();
