/**
 * Remove a data lake object that is no longer needed. Read it first to see its fields and status.
 *
 * Salesforce's tool text says this removes the DLO and its data, and to check that no mappings or data streams reference it first. No source says what happens if one does.
 */

call cdp.dlo_get (record_id_or_developer_name => 'Loyalty_Member__dll');

call cdp.dlo_delete (record_id_or_developer_name => 'Loyalty_Member__dll');
