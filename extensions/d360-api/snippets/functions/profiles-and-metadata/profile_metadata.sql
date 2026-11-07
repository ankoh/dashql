/**
 * List the Profile DMOs with their fields and indexes. It covers less than the general metadata call but names the lookups that are fast.
 *
 * The result is one row, with all DMOs in its `metadata` array. Its `indexes` show which fields support efficient lookups.
 */

call cdp.profile_metadata ();

call cdp.profile_metadata_get (data_model_name => 'ssot__Individual__dlm');
