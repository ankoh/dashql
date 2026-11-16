/**
 * Get the fields, data types and indexes of one Profile DMO. Read it before filtering, since an indexed field answers faster.
 */

call d360.profile_metadata ();

call d360.profile_metadata_get (data_model_name => 'ssot__Individual__dlm');
