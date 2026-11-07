/**
 * List all identity resolution rulesets of the org, to find one by its label.
 *
 * Each row has the full rules, so one call is enough. There is no data space filter: filter on `dataspace_name` yourself. The `id` is what the other calls take.
 */

call cdp.ir_list ();

call cdp.ir_get (identity_resolution => '1irfj000000IWhWAAW');
