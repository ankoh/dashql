/**
 * Read the semantic layer permissions, before building models. The sources say little about what comes back, so read the result.
 */

call d360.sdm_permissions ();

call d360.sdm_list (dataspace => 'default');
