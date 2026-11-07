/**
 * Step 2 of the data space.
 *
 * Add an object to it.
 */

CALL cdp.dataspace_member_add (id_or_name => 'nonDefault', members => (members = [(member_name = 'Orders__dll', filter = (conjunctive_operator = 'NoneOperator', conditions = (conditions = [])))]));
