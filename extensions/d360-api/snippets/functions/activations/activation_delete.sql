/**
 * Remove an activation once nothing downstream needs its data. Read it first to see which activation target it feeds.
 *
 * There are no dependency checks, and Data 360 stops sending data to every downstream system tied to the activation as soon as it is gone. An id that doesn't exist returns "Activation not found for Id".
 */

call cdp.activation_get (activation_id => '85RVF000000CEf72AG');

call cdp.activation_delete (activation_id => '85RVF000000CEf72AG');
