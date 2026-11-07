/**
 * Pause a market segment activation without deleting it. Read it first, so that you know what you are stopping.
 *
 * It describes market segment activations and doesn't cover DMO activations. `dataspace` sets the data space the request runs in.
 */

call cdp.activation_get (activation_id => '85RVF000000CEf72AG');

call cdp.activation_disable (activation_id => '85RVF000000CEf72AG', dataspace => 'default');
