/**
 * Add fields to a data lake object, and set its label in the same call.
 *
 * The spec requires `label`, so send the current one when you only add fields. Name new fields without `__c`. Read the DLO afterwards to see the fields as stored.
 */

call cdp.dlo_update (
    record_id_or_developer_name => 'Loyalty_Member__dll',
    label => 'Loyalty Member',
    fields => [
        (name = 'Tier', label = 'Tier', data_type = 'Text', is_primary_key = false),
        (name = 'Points', label = 'Points', data_type = 'Number', is_primary_key = false)
    ]
);

call cdp.dlo_get (record_id_or_developer_name => 'Loyalty_Member__dll');
