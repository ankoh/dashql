//! Made-up client functions for the tests of the core, so that they can't start to depend on a real service.

/// A ticket service. It covers what the core reads: required and unknown options, nested schemas, recursion, free-form
/// objects, unions, paging, pending results and the escape hatch.
pub const TICKETS: &str = r#"{
  "format": 1,
  "namespace": "tickets",
  "title": "Ticket Service",
  "hosts": { "api": { "base_path": "/api/v{api_version}" } },
  "errors": { "message": ["/error/message"] },
  "schemas": {
    "Assignee": {
      "attributes": [
        { "name": "id", "api_name": "id", "type": "integer", "required": true, "description": "The id of the user." },
        { "name": "notify", "api_name": "notifyUser", "type": "boolean" }
      ]
    },
    "Component": {
      "attributes": [
        { "name": "name", "api_name": "name", "type": "string" },
        { "name": "children", "api_name": "children", "schema": "Component" }
      ]
    },
    "Inferred": {
      "unknown": "warning",
      "attributes": [{ "name": "known", "api_name": "known", "type": "string" }]
    },
    "Free": { "unknown": "allow" },
    "EmailTarget": {
      "attributes": [
        { "name": "kind", "api_name": "kind", "type": "string", "required": true },
        { "name": "address", "api_name": "emailAddress", "type": "string", "required": true },
        { "name": "owner", "api_name": "owner", "schema": "Assignee" }
      ]
    },
    "QueueTarget": {
      "attributes": [
        { "name": "kind", "api_name": "kind", "type": "string", "required": true },
        { "name": "queue", "api_name": "queueName", "type": "string", "required": true },
        { "name": "owner", "api_name": "owner", "schema": "Assignee" }
      ]
    },
    "Target": {
      "variants": ["EmailTarget", "QueueTarget"],
      "tag": { "attribute": "kind", "values": { "Email": "EmailTarget", "Queue": "QueueTarget" } }
    },
    "CronTrigger": { "attributes": [{ "name": "cron", "api_name": "cron", "type": "string", "required": true }] },
    "EventTrigger": {
      "attributes": [
        { "name": "event", "api_name": "event", "type": "string", "required": true },
        { "name": "filter", "api_name": "filter", "type": "string" }
      ]
    },
    "Trigger": { "variants": ["CronTrigger", "EventTrigger"] }
  },
  "functions": [
    {
      "name": "ticket_list",
      "family": "Tickets",
      "description": "Lists the tickets of a project, see `ticket_feed` for a feed.",
      "example": "CALL tickets.ticket_list (project => 'CORE');",
      "result_description": "One row per item of `/items` in the response.",
      "method": "GET",
      "host": "api",
      "path": "/projects/{project}/tickets",
      "options": [
        { "name": "project", "api_name": "project", "in": "path", "type": "string", "required": true, "description": "The key of the project." },
        { "name": "page_size", "api_name": "pageSize", "in": "query", "type": "integer" },
        { "name": "page_token", "api_name": "pageToken", "in": "query", "type": "string" }
      ],
      "rows": "/items",
      "columns": [{ "name": "id", "api_name": "id", "type": "BIGINT" }],
      "paging": { "kind": "token", "from": { "body": "/nextPageToken" }, "option": "page_token" }
    },
    {
      "name": "ticket_feed",
      "method": "GET",
      "host": "api",
      "path": "/feed",
      "options": [{ "name": "project", "api_name": "project", "in": "query", "type": "string", "required": true }],
      "paging": { "kind": "url", "from": { "link": "next" } }
    },
    {
      "name": "ticket_create",
      "family": "Tickets",
      "method": "POST",
      "host": "api",
      "path": "/tickets",
      "options": [
        { "name": "project", "api_name": "project", "in": "body", "type": "string", "required": true },
        { "name": "title", "api_name": "title", "in": "body", "type": "string", "required": true },
        { "name": "labels", "api_name": "labels", "in": "body", "type": "any" },
        { "name": "assignee", "api_name": "assignee", "in": "body", "schema": "Assignee" },
        { "name": "components", "api_name": "components", "in": "body", "schema": "Component" },
        { "name": "owners", "api_name": "ownerMap", "in": "body", "schema": "Assignee", "map": true },
        { "name": "inferred", "api_name": "inferred", "in": "body", "schema": "Inferred" },
        { "name": "metadata", "api_name": "metadata", "in": "body", "schema": "Free" },
        { "name": "affected", "api_name": "affected", "in": "body", "type": "sql" },
        { "name": "DataSourceId__c", "api_name": "DataSourceId__c", "in": "body", "type": "string" },
        { "name": "X-Trace-Id", "api_name": "X-Trace-Id", "in": "header", "type": "string" }
      ]
    },
    {
      "name": "ticket_delete",
      "method": "DELETE",
      "host": "api",
      "path": "/tickets/{id}",
      "options": [{ "name": "id", "api_name": "id", "in": "path", "type": "integer", "required": true }]
    },
    {
      "name": "ticket_search",
      "method": "POST",
      "effect": "read",
      "host": "api",
      "path": "/tickets:search",
      "unknown": "warning",
      "options": [{ "name": "query", "api_name": "q", "in": "body", "type": "string" }]
    },
    {
      "name": "export_start",
      "method": "POST",
      "host": "api",
      "path": "/exports",
      "pending": { "status": 202, "poll": { "header": "Location" } },
      "options": [{ "name": "format", "api_name": "format", "in": "body", "type": "string", "required": true }]
    },
    {
      "name": "webhook_create",
      "method": "POST",
      "host": "api",
      "path": "/webhooks",
      "options": [
        { "name": "url", "api_name": "url", "in": "body", "type": "string" },
        { "name": "signing_key", "api_name": "signingKey", "in": "body", "type": "string" },
        { "name": "credentials", "api_name": "credentials", "in": "body", "type": "any" }
      ]
    },
    {
      "name": "rule_create",
      "method": "POST",
      "host": "api",
      "path": "/rules",
      "options": [
        { "name": "target", "api_name": "target", "in": "body", "schema": "Target" },
        { "name": "trigger", "api_name": "trigger", "in": "body", "schema": "Trigger" }
      ]
    },
    { "name": "request", "raw": true, "host": "api" }
  ]
}"#;
