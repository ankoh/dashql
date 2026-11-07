/**
 * Turn a disabled market segment activation back on, then read it to see that it is enabled.
 *
 * It describes market segment activations and doesn't cover DMO activations. `dataspace` sets the data space the request runs in.
 */

call cdp.activation_enable (activation_id => '85RVF000000CEf72AG', dataspace => 'default');

call cdp.activation_get (activation_id => '85RVF000000CEf72AG');
