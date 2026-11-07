/**
 * Step 4 of the data space.
 *
 * Other calls now read from the space through `dataspace`.
 */

call cdp.segment_list (dataspace => 'nonDefault');
