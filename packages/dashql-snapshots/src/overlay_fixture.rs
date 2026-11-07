//! A made-up overlay for the tests of the core, so that they can't start to depend on a real service.

/// A ticket service. It covers what the core reads: required and unknown options, nested schemas, recursion, free-form
/// objects, paging, pending results, sensitive values and the escape hatch.
pub const TICKETS: &str = r#"{
  "format": 1,
  "namespace": "tickets",
  "title": "Ticket Service",
  "hosts": { "api": { "base_path": "/api/v{api_version}" } },
  "errors": { "message": ["/error/message"] },
  "schemas": {
    "Assignee": {
      "attributes": [
        { "name": "id", "wire": "id", "type": "integer", "required": true },
        { "name": "notify", "wire": "notifyUser", "type": "boolean" }
      ]
    },
    "Component": {
      "attributes": [
        { "name": "name", "wire": "name", "type": "string" },
        { "name": "children", "wire": "children", "schema": "Component" }
      ]
    },
    "Inferred": {
      "unknown": "warning",
      "attributes": [{ "name": "known", "wire": "known", "type": "string" }]
    },
    "Free": { "unknown": "allow" }
  },
  "functions": [
    {
      "name": "ticket_list",
      "family": "Tickets",
      "method": "GET",
      "host": "api",
      "path": "/projects/{project}/tickets",
      "options": [
        { "name": "project", "wire": "project", "in": "path:project", "type": "string", "required": true },
        { "name": "page_size", "wire": "pageSize", "in": "query", "type": "integer" },
        { "name": "page_token", "wire": "pageToken", "in": "query", "type": "string" }
      ],
      "rows": "/items",
      "columns": [{ "name": "id", "wire": "id", "type": "BIGINT" }],
      "paging": { "kind": "token", "from": "/nextPageToken", "option": "page_token" }
    },
    {
      "name": "ticket_feed",
      "method": "GET",
      "host": "api",
      "path": "/feed",
      "options": [{ "name": "project", "wire": "project", "in": "query", "type": "string", "required": true }],
      "paging": { "kind": "url", "from": "header:Link#next" }
    },
    {
      "name": "ticket_create",
      "family": "Tickets",
      "method": "POST",
      "host": "api",
      "path": "/tickets",
      "options": [
        { "name": "project", "wire": "project", "in": "body", "type": "string", "required": true },
        { "name": "title", "wire": "title", "in": "body", "type": "string", "required": true },
        { "name": "labels", "wire": "labels", "in": "body", "type": "any" },
        { "name": "assignee", "wire": "assignee", "in": "body", "schema": "Assignee" },
        { "name": "components", "wire": "components", "in": "body", "schema": "Component" },
        { "name": "inferred", "wire": "inferred", "in": "body", "schema": "Inferred" },
        { "name": "metadata", "wire": "metadata", "in": "body", "schema": "Free" },
        { "name": "affected", "wire": "affected", "in": "body", "type": "sql" },
        { "name": "DataSourceId__c", "wire": "DataSourceId__c", "in": "body", "type": "string" },
        { "name": "X-Trace-Id", "wire": "X-Trace-Id", "in": "header", "type": "string" }
      ]
    },
    {
      "name": "ticket_delete",
      "method": "DELETE",
      "host": "api",
      "path": "/tickets/{id}",
      "options": [{ "name": "id", "wire": "id", "in": "path:id", "type": "integer", "required": true }]
    },
    {
      "name": "ticket_search",
      "method": "POST",
      "effect": "read",
      "host": "api",
      "path": "/tickets:search",
      "unknown": "warning",
      "options": [{ "name": "query", "wire": "q", "in": "body", "type": "string" }]
    },
    {
      "name": "export_start",
      "method": "POST",
      "host": "api",
      "path": "/exports",
      "pending": { "status": 202, "poll": "header:Location" },
      "options": [{ "name": "format", "wire": "format", "in": "body", "type": "string", "required": true }]
    },
    {
      "name": "webhook_create",
      "method": "POST",
      "host": "api",
      "path": "/webhooks",
      "options": [
        { "name": "url", "wire": "url", "in": "body", "type": "string" },
        { "name": "signing_key", "wire": "signingKey", "in": "body", "type": "string" },
        { "name": "credentials", "wire": "credentials", "in": "body", "type": "any" }
      ],
      "sensitive": [
        { "pointer": "/signing_key" },
        { "pointer": "/credentials/*/value", "public_when": { "param_name": ["user", "account"] } }
      ]
    },
    { "name": "request", "raw": true, "host": "api" }
  ]
}"#;
