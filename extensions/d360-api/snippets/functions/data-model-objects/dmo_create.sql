/**
 * Create a custom data model object for loyalty members, with a primary key and a date field.
 *
 * Pass the bare name: the `__dlm` suffix is added. At least one field must be a primary key, and `dataspace_name` should be set, because mapping a DMO created without it fails with `DMO not found`. The DMO can take a minute or more: wait until `dmo_get` returns a `dataSpaceName` in `_raw`.
 */

call cdp.dmo_create (
    name => 'LoyaltyMembers',
    label => 'Loyalty Members',
    description => 'Members of the loyalty program',
    dataspace_name => 'default',
    category => 'Profile',
    fields => [
        (name = 'MemberId', label = 'Member Id', is_primary_key = true, data_type = 'Text'),
        (name = 'Tier', label = 'Tier', is_primary_key = false, data_type = 'Text'),
        (name = 'JoinedAt', label = 'Joined At', is_primary_key = false, data_type = 'DateTime')
    ]
);

call cdp.dmo_get (data_model_object_name => 'LoyaltyMembers__dlm');
