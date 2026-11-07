/**
 * List the delivery channels of a data space and whether the org has data for them, before you pick contact points for an activation.
 *
 * A channel with `is_mapped` false has no data mapped to its contact point DMO in this data space. Here `filters` takes `field eq value`, unlike `activation_list`.
 */

call cdp.activation_channel_list (
    activate_on => 'ssot__Individual__dlm',
    dataspace => 'default',
    filters => 'channelType eq Email',
    order_by => 'label asc',
    batch_size => 50
);
