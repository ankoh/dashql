/**
 * List the Profile DMOs with their fields, indexes and relationships on the tenant host. Then describe one of them.
 */

call cdp.direct_profile_metadata ();

call cdp.direct_profile_metadata_get (data_model_name => 'Individual__dlm');
