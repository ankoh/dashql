/**
 * Read the records an activation delivered, to check that the audience arrived the way you configured it.
 *
 * `X-Chatter-Entity-Encoding` has to be `false`. Set `batch_size` yourself, because the default of 10000 is above the maximum of 4999. `activation_record` is a JSON string, and `A` is the only documented `delta_type`.
 */

call cdp.activation_record_list (
    "X-Chatter-Entity-Encoding" => 'false',
    activation_id => '85RVF000000CEf72AG',
    filters => 'delta_type__c in ''A''',
    batch_size => 1000,
    offset => 0
);
