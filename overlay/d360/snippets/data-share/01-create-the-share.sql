/**
 * Step 1 of the data share.
 *
 * Share two objects of the data space.
 */

CALL cdp.data_share_create (name => 'Sales_Data_Share', label => 'Sales Data Share', dataspace_name => 'default', data_share_objects => ['Sales_Order__dlm', 'Account_Home__dll']);
