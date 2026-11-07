/**
 * Read one data lake object with its fields. Call it before mapping the DLO to a data model object: the exact field names for the mapping are in `data_lake_field_info_representation`.
 *
 * The developer name includes the suffix, such as `Account_Home__dll`. Fields created as `Bar` come back as `Bar__c`.
 */

call cdp.dlo_list (limit => 20, order_by => 'ASC');

call cdp.dlo_get (record_id_or_developer_name => 'Account_Home__dll');
