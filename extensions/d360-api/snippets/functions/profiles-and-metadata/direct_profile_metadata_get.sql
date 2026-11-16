/**
 * Get the fields, indexes and relationships of one Profile DMO on the tenant host. List the Profile DMOs first for the name.
 */

call d360.direct_profile_metadata ();

call d360.direct_profile_metadata_get (data_model_name => 'Individual__dlm');
