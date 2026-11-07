/**
 * Register an agent for Agentic Memory and Context, with its profile DMO and a data graph that gives it context. Do this once per agent, before any memory or context call.
 *
 * Registration provisions the infrastructure and takes a while. Read the agent until `status` is `Active`, comparing case-insensitively. The profile DMO applies to the whole data space and can't be changed afterwards.
 */

call cdp.agent_create (
    name => 'support_agent',
    label => 'Support Agent',
    description => 'Support chat with customer memory',
    configuration => (
        profile_dmos = [(name = 'UnifiedIndividual__dlm')],
        context_data_sources = (data_graphs = [(name = 'CustomerDG1')])
    )
);

call cdp.agent_get (agent_id_or_api_name => 'support_agent');
