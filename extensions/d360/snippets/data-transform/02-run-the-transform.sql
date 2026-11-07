/**
 * Step 2 of a data transform, runs the transform of step 1 and reads its result object.
 */

call cdp.transform_run (data_transform_name_or_id => 'account_summary');

call cdp.dlo_get (record_id_or_developer_name => 'Account_Summary__dll');
