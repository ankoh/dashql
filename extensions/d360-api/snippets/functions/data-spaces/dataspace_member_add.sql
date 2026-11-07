/**
 * Add a data lake object to a data space, restricted by a filter, or change the filter of one that is already a member.
 *
 * Here only the rows of `Orders__dll` where `Region__c` is `EMEA` are visible in the space. Both creating and updating are the same call. The member starts as `PROCESSING`: read it until `status` is `ACTIVE`, `ERROR` means failed, and compare without regard to case.
 */

call cdp.dataspace_member_add (
    id_or_name => 'nonDefault',
    members => (
        members = [(
            member_name = 'Orders__dll',
            filter = (
                conjunctive_operator = 'OrOperator',
                condition_groups = [],
                conditions = (
                    conditions = [(
                        field_name = 'Region__c',
                        filter_value = 'EMEA',
                        operator = 'EqualsOperator',
                        table_name = 'Orders__dll'
                    )]
                )
            )
        )]
    )
);

call cdp.dataspace_member_get (dataspace_member_object_name => 'Orders__dll', id_or_name => 'nonDefault');
