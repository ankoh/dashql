/**
 * Get the standard consent DMOs of a data space, to filter an activation by the consent of its contact points.
 *
 * The result is one row with the two consent objects, contact point consent and communication subscription consent.
 */

call d360.activation_consent_dmo_list (activate_on => 'ssot__Individual__dlm', dataspace => 'default');

call d360.activation_channel_list (activate_on => 'ssot__Individual__dlm', dataspace => 'default');
