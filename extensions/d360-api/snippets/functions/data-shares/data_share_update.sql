/**
 * Rename a data share and change which objects it exposes.
 *
 * This changes what consumers can see: added objects become reachable through the linked targets, removed ones stop being reachable. The spec doesn't say whether `data_share_objects` replaces the list or adds to it, so send the complete list as its request example does. Names carry their suffix: `__dll`, `__dlm` or `__cio`. Read the share until `status` is `Active`.
 */

call cdp.data_share_update (
    name_or_id => 'Sales_Data_Share',
    label => 'Sales Data Share (Updated)',
    description => 'Added order-line DMO',
    data_share_objects => [
        'Account_Home__dll',
        'Sales_Order__dlm',
        'Sales_Order_Line__dlm',
        'Contact_Point_Email__cio'
    ]
);

call cdp.data_share_get (name_or_id => 'Sales_Data_Share');
