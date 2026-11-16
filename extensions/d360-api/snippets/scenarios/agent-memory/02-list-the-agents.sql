/**
 * Step 2 of agent memory.
 *
 * Repeat until the `status` of the agent is `Active`, because the next steps return errors while it's `Processing`.
 */

call d360.agent_list (limit => 50);
