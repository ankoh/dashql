/**
 * Read the semantic layer permissions, before building models. The sources say little about what comes back, so read the result.
 */

call cdp.sdm_permissions ();

call cdp.sdm_list (dataspace => 'default');
