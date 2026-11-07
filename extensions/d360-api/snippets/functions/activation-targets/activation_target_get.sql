/**
 * Read one activation target to see its platform, connector and status before you create an activation on it.
 *
 * Use the id, since the name may fail. Compare `status` without case, because it arrives as `ACTIVE` as often as `Active`.
 */

call cdp.activation_target_list (filters => 'targetStatus in active', order_by => 'createdDate desc');

call cdp.activation_target_get (activation_target_id => '85UVF000000Dr4v2AC');
