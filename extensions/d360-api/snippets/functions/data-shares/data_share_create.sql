/**
 * Create a data share that exposes DMOs, DLOs and calculated insights to external consumers.
 *
 * Object names carry their type suffix: `__dll` for a DLO, `__dlm` for a DMO, `__cio` for a calculated insight. The share has to be `Active` before it can be linked to a target, so read it until it is. The spec marks nothing required, but every example sends `name` and `label`.
 */

call cdp.data_share_create (
    name => 'Sales_Data_Share',
    label => 'Sales Data Share',
    dataspace_name => 'default',
    description => 'Shares sales DMOs and DLOs with external partners',
    data_share_objects => ['Account_Home__dll', 'Sales_Order__dlm', 'Contact_Point_Email__cio']
);

call cdp.data_share_get (name_or_id => 'Sales_Data_Share');
