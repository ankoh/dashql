//! Running a call: a state machine over the requests of a call, its pages and its polls, and `EXPLAIN`.
//!
//! A run starts with the description of the core and returns the first request. The host resolves the host of the
//! request with the binding of the connection, sends it and hands the response back, and the run answers with the next
//! request, a wait or the result table. The host owns the clock and the timers: every step takes the time, and a wait
//! is a step that the host answers with `on_wake` once the time is over. Canceling a call is dropping the run.
//!
//! Ported from `connections/clfn/clfn_runtime.ts` of `packages/dashql-runtime`.

use std::rc::Rc;

use serde_json::{Map, Value};

use crate::http::{Headers, HttpResponse};
use super::json::{
    is_empty_value, js_number, js_string, json_pointer_segments, number_value, read_json_pointer, to_json_text,
};
use super::request::{
    build_client_function_request, follow_request, is_standard_option, ClientFunctionRequest, ClientFunctionVariables,
};
use super::result::{convert_value, Cell, ClientFunctionResult, ColumnType, ResultField};
use super::spec::{
    ClientFunction, ClientFunctionCallDescription, ClientFunctionColumn, ClientFunctionPaging, ClientFunctionPending,
    ClientFunctionPoll, ClientFunctionSpec,
};
use super::ClientFunctionError;

/// The first and the longest wait between two polls
const POLL_MIN_MS: f64 = 1000.0;
const POLL_MAX_MS: f64 = 10000.0;
/// The value of `_poll` for a request that is repeated
pub const POLL_SAME: &str = "same";

/// What the host does next for a call
#[derive(Debug, Clone, PartialEq)]
pub enum CallStep {
    /// Resolve the host of the request with the binding, send it and pass the response to `on_response`
    Send(ClientFunctionRequest),
    /// Wait for the milliseconds and call `on_wake`
    Sleep { ms: f64 },
    /// The call finished with its result
    Done(ClientFunctionResult),
}

/// One page of a response
#[derive(Debug, Clone)]
struct Page {
    /// The status
    status: u16,
    /// The rows of the page, the fields as the API sent them
    items: Vec<Value>,
    /// The fields outside the rows
    meta: Option<Map<String, Value>>,
    /// The parsed body
    body: Value,
    /// The headers
    headers: Headers,
    /// A body that doesn't hold the rows the spec promises. It ends the list and lands in `_raw`, so a spec that
    /// disagrees with a response doesn't look like an empty list.
    unexpected: Option<Value>,
}

impl Page {
    /// The value of a header
    fn header(&self, name: &str) -> Option<String> {
        self.headers.get(name).map(str::to_string)
    }
}

/// Read the entry with a `rel` of a `Link` header
fn read_link(link: Option<&str>, rel: &str) -> Option<String> {
    let wanted = rel.to_lowercase();
    for entry in link.unwrap_or("").split(',') {
        let entry = entry.trim();
        let Some(rest) = entry.strip_prefix('<') else { continue };
        let Some((target, params)) = rest.split_once('>') else { continue };
        for param in params.split(';') {
            let Some((name, value)) = param.split_once('=') else { continue };
            if !name.trim().eq_ignore_ascii_case("rel") {
                continue;
            }
            let value = value.trim().trim_matches('"').trim();
            if value.to_lowercase() == wanted {
                return Some(target.to_string());
            }
        }
    }
    None
}

/// Parse a response body. What isn't JSON stays text, it ends up in `_raw`. No body is a null.
fn parse_body(text: &str) -> Value {
    if text.is_empty() {
        return Value::Null;
    }
    serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string()))
}

/// An object without the value at a path and without the objects that this leaves empty, none if nothing is left
fn without_path(object: &Map<String, Value>, segments: &[String]) -> Option<Map<String, Value>> {
    let (segment, rest) = segments.split_first()?;
    let mut out: Map<String, Value> =
        object.iter().filter(|(k, _)| *k != segment).map(|(k, v)| (k.clone(), v.clone())).collect();
    let inner = match object.get(segment) {
        Some(Value::Object(child)) if !rest.is_empty() => without_path(child, rest),
        _ => None,
    };
    if let Some(inner) = inner {
        out.insert(segment.clone(), Value::Object(inner));
    }
    (!out.is_empty()).then_some(out)
}

/// The options of a call with `_next` applied, if that sets an option
fn options_with_next(function: &ClientFunction, options: &Map<String, Value>) -> Map<String, Value> {
    let next = options.get("_next").filter(|v| !v.is_null());
    let (Some(next), Some(paging)) = (next, &function.paging) else { return options.clone() };
    let Some(option) = paging.option.as_ref().filter(|_| paging.kind != "url") else { return options.clone() };
    let mut out = options.clone();
    out.insert(option.clone(), if paging.is_numeric() { number_value(js_number(next)) } else { next.clone() });
    out
}

/// The first request of a call, which a run sends and `EXPLAIN` prints. A followed `_next` or `_poll` URL replaces the
/// path and query, the headers of options still apply.
fn first_request(
    spec: &ClientFunctionSpec,
    function: &ClientFunction,
    options: &Map<String, Value>,
    variables: &dyn Fn(&str) -> Option<String>,
) -> Result<ClientFunctionRequest, ClientFunctionError> {
    let label = format!("{}.{}", spec.namespace, function.name);
    let next = options.get("_next").filter(|v| !v.is_null());
    let poll = options.get("_poll").filter(|v| !v.is_null());
    // Only a request that repeats has this value, anything else would send the request again, even a write
    let repeats = matches!(spec.pending_of(function), Some(ClientFunctionPending { poll: ClientFunctionPoll::Repeat, .. }));
    let poll_same = poll.is_some_and(|p| p.as_str() == Some(POLL_SAME));
    if poll_same && !repeats {
        return Err(ClientFunctionError::new(format!("{label} polls a URL, _poll takes the value of its result")));
    }
    let followed = match (next, poll) {
        (Some(next), _) if function.paging.as_ref().is_some_and(|p| p.kind == "url") => Some(next),
        (_, Some(poll)) if !poll_same => Some(poll),
        _ => None,
    };
    let Some(followed) = followed else {
        return build_client_function_request(spec, function, &options_with_next(function, options), variables);
    };
    if function.raw {
        return Err(ClientFunctionError::new(format!("{label} can't follow a URL")));
    }
    let Some(host) = &function.host else {
        return Err(ClientFunctionError::new(format!("{label} has no host")));
    };
    let headers = function
        .options
        .iter()
        .filter(|o| o.location.as_deref() == Some("header"))
        .filter_map(|o| options.get(&o.name).filter(|v| !v.is_null()).map(|v| (o.api_name().to_string(), js_string(v))))
        .collect();
    let base = ClientFunctionRequest {
        method: "GET".to_string(),
        host: host.clone(),
        path: String::new(),
        query: Vec::new(),
        headers,
        body: None,
        follow_url: None,
    };
    Ok(follow_request(&base, &js_string(followed)))
}

/// The lookup of variables, a missing one fails the request
fn lookup(variables: &ClientFunctionVariables) -> impl Fn(&str) -> Option<String> + '_ {
    move |name| variables.get(name).cloned()
}

/// Where a run is
#[derive(Debug, Clone)]
enum Phase {
    /// A request of a page is out
    Sending,
    /// The run waits before it polls
    Sleeping { poll: String },
    /// The run finished
    Done,
}

/// A run of a call. It holds the spec, a run is independent of the connection once it started.
#[derive(Debug)]
pub struct ClientFunctionCallRun {
    spec: Rc<ClientFunctionSpec>,
    function: ClientFunction,
    pending: Option<ClientFunctionPending>,
    columns: Vec<ClientFunctionColumn>,
    variables: ClientFunctionVariables,
    /// The options of the call, with `_next` applied
    send: Map<String, Value>,
    /// The `_next` of the call
    next: Option<Value>,
    /// The pages that a call wants
    pages: u32,
    /// The time that a page waits while it's pending, in seconds
    wait_seconds: f64,
    /// The page size that the call asked for
    size: Option<f64>,
    /// The offset or the page number of the current page
    position: f64,
    /// The request of the current page
    page_request: ClientFunctionRequest,
    /// The request that is out, the page request or one that polls
    current: ClientFunctionRequest,
    /// When the current page stops waiting
    deadline: f64,
    /// The next wait between two polls
    delay: f64,
    /// The pages so far
    page_rows: Vec<Page>,
    /// The value for the next page after the last page
    last_next: Option<String>,
    /// The index of the current page
    page_index: u32,
    phase: Phase,
}

impl ClientFunctionCallRun {
    /// Start a call. A call that writes is sent like any other: the planner leaves a script with one out of the runs of
    /// the workbook and of input changes, see docs/design/client_functions.md. Fails before anything is sent.
    pub fn start(
        spec: Rc<ClientFunctionSpec>,
        description: &ClientFunctionCallDescription,
        variables: ClientFunctionVariables,
        now: f64,
    ) -> Result<(Self, CallStep), ClientFunctionError> {
        description.require_values()?;
        let function = spec.function(&description.function)?.clone();
        let label = format!("{}.{}", spec.namespace, function.name);
        let pending = spec.pending_of(&function);
        // A raw call has no columns, its response is in `_raw`
        let columns = if function.raw { Vec::new() } else { function.columns.clone() };
        let options = &description.options;
        let next = options.get("_next").filter(|v| !v.is_null()).cloned();
        let poll = options.get("_poll").filter(|v| !v.is_null());
        let pages = options.get("_pages").filter(|v| !v.is_null()).map_or(1.0, js_number);
        let wait = options.get("_wait").filter(|v| !v.is_null()).map_or(0.0, js_number);
        if !(pages.is_finite() && pages == pages.trunc() && pages >= 1.0) {
            return Err(ClientFunctionError::new("_pages takes a positive number"));
        }
        if !(wait.is_finite() && wait >= 0.0) {
            return Err(ClientFunctionError::new("_wait takes a number of seconds"));
        }
        if next.is_some() && poll.is_some() {
            return Err(ClientFunctionError::new("_next and _poll continue different things, use one of them"));
        }
        if poll.is_some() && pending.is_none() {
            return Err(ClientFunctionError::new(format!("{label} has no option _poll")));
        }
        if (next.is_some() || pages > 1.0) && function.paging.is_none() {
            return Err(ClientFunctionError::new(format!("{label} doesn't page")));
        }

        let send = options_with_next(&function, options);
        let request = first_request(&spec, &function, options, &lookup(&variables))?;
        let numeric = function.paging.as_ref().is_some_and(ClientFunctionPaging::is_numeric);
        let start = function.paging.as_ref().and_then(|p| p.start).unwrap_or(0.0);
        let size = function.paging.as_ref().and_then(|p| p.size.as_ref()).and_then(|s| options.get(s)).and_then(Value::as_f64);
        let position = match function.paging.as_ref().and_then(|p| p.option.as_ref()) {
            Some(option) if numeric => send.get(option).and_then(Value::as_f64).unwrap_or(start),
            _ if numeric => start,
            _ => 0.0,
        };
        let run = Self {
            spec,
            function,
            pending,
            columns,
            variables,
            send,
            next,
            pages: pages.min(f64::from(u32::MAX)) as u32,
            wait_seconds: wait,
            size,
            position,
            page_request: request.clone(),
            current: request.clone(),
            deadline: now + wait * 1000.0,
            delay: POLL_MIN_MS,
            page_rows: Vec::new(),
            last_next: None,
            page_index: 0,
            phase: Phase::Sending,
        };
        Ok((run, CallStep::Send(request)))
    }

    /// The label of the function
    fn label(&self) -> String {
        format!("{}.{}", self.spec.namespace, self.function.name)
    }

    /// The fields of the result
    pub fn fields(&self) -> Vec<ResultField> {
        let mut fields: Vec<ResultField> = self
            .columns
            .iter()
            .map(|c| ResultField { name: c.name.clone(), column_type: ColumnType::of(c.column_type.as_deref()) })
            .collect();
        let text = |name: &str| ResultField { name: name.to_string(), column_type: ColumnType::Varchar };
        fields.push(ResultField { name: "_status".to_string(), column_type: ColumnType::Integer });
        fields.push(text("_next"));
        if self.pending.is_some() {
            fields.push(text("_poll"));
        }
        fields.push(text("_meta"));
        fields.push(text("_raw"));
        fields
    }

    /// A row with only the standard columns
    fn standard_row(&self, status: u16, next: Option<&str>, poll: Option<&str>, meta: Option<&Value>, raw: Option<&Value>) -> Vec<Cell> {
        let mut row: Vec<Cell> = self.columns.iter().map(|_| Cell::Null).collect();
        row.push(Cell::Int32(i32::from(status)));
        row.push(Cell::text(next.map(str::to_string)));
        if self.pending.is_some() {
            row.push(Cell::text(poll.map(str::to_string)));
        }
        row.push(Cell::text(meta.filter(|m| !m.is_null()).map(to_json_text)));
        row.push(Cell::text(raw.filter(|r| !r.is_null()).map(to_json_text)));
        row
    }

    /// A row of an item: the listed fields in their columns, everything else in `_raw`
    fn item_row(&self, item: &Value, page: &Page, next: Option<&str>) -> Vec<Cell> {
        let meta = page.meta.clone().map(Value::Object);
        let Value::Object(fields) = item else {
            return self.standard_row(page.status, next, None, meta.as_ref(), Some(item));
        };
        let mut rest = fields.clone();
        let mut row: Vec<Cell> = Vec::with_capacity(self.columns.len() + 5);
        for column in &self.columns {
            let api_name = column.api_name();
            let converted = convert_value(rest.get(api_name), ColumnType::of(column.column_type.as_deref()));
            // A value that can't be converted stays in `_raw`, so a spec that disagrees doesn't fail the statement
            if converted.is_some() {
                rest.shift_remove(api_name);
            }
            row.push(converted.unwrap_or(Cell::Null));
        }
        row.push(Cell::Int32(i32::from(page.status)));
        row.push(Cell::text(next.map(str::to_string)));
        if self.pending.is_some() {
            row.push(Cell::Null);
        }
        row.push(Cell::text(meta.as_ref().map(to_json_text)));
        row.push(Cell::text((!rest.is_empty()).then(|| to_json_text(&Value::Object(rest)))));
        row
    }

    /// A value that the spec points to
    fn read_source(&self, source: Option<&Value>, page: &Page) -> Result<Option<Value>, ClientFunctionError> {
        let Some(source) = source else { return Ok(None) };
        let field = |name: &str| source.get(name).map(js_string);
        if let Some(pointer) = field("last_row") {
            return Ok(page.items.last().and_then(|last| read_json_pointer(last, &pointer)).cloned());
        }
        if let Some(rel) = field("link") {
            return Ok(read_link(page.header("Link").as_deref(), &rel).map(Value::String));
        }
        if let Some(header) = field("header") {
            return Ok(page.header(&header).map(Value::String));
        }
        if let Some(pointer) = field("body") {
            return Ok(read_json_pointer(&page.body, &pointer).cloned());
        }
        // A mistake in a spec would end the list without a word otherwise
        Err(ClientFunctionError::new(format!("the spec reads a value from the unknown source {}", to_json_text(source))))
    }

    /// Does the list end after a page? Only a documented rule ends it early, so an empty page is the default.
    fn is_last_page(&self, paging: &ClientFunctionPaging, page: &Page) -> bool {
        let rows = page.items.len() as f64;
        match &paging.end {
            None => page.items.is_empty(),
            Some(Value::String(end)) if end == "empty_page" => page.items.is_empty(),
            Some(Value::String(end)) if end == "short_page" => match self.size {
                None => page.items.is_empty(),
                Some(size) => rows < size,
            },
            Some(end) if end.get("has_more").is_some() => {
                let pointer = end.get("has_more").map(js_string).unwrap_or_default();
                read_json_pointer(&page.body, &pointer) != Some(&Value::Bool(true))
            }
            Some(end) => {
                let pointer = end.get("total").map(js_string).unwrap_or_default();
                let total = read_json_pointer(&page.body, &pointer).map_or(f64::NAN, js_number);
                if total.is_nan() {
                    return page.items.is_empty();
                }
                // A total counts the pages of a page number, and the rows of an offset
                if paging.kind == "page" {
                    self.position - paging.start.unwrap_or(0.0) + 1.0 >= total
                } else {
                    self.position + rows >= total
                }
            }
        }
    }

    /// The value for the next page, none on the last page
    fn next_value(&self, page: &Page) -> Result<Option<String>, ClientFunctionError> {
        let Some(paging) = &self.function.paging else { return Ok(None) };
        if paging.kind == "url" || paging.kind == "token" {
            let value = self.read_source(paging.from.as_ref(), page)?;
            if is_empty_value(value.as_ref()) {
                return Ok(None);
            }
            if paging.end.is_some() && self.is_last_page(paging, page) {
                return Ok(None);
            }
            return Ok(value.as_ref().map(js_string));
        }
        if self.is_last_page(paging, page) {
            return Ok(None);
        }
        // Pages can be shorter than asked for, an offset follows the rows that arrived
        let next = if paging.kind == "offset" { self.position + page.items.len() as f64 } else { self.position + 1.0 };
        Ok(Some(super::json::js_number_text(next)))
    }

    /// The error message of a response
    fn error_message(&self, body: &Value, fallback: String) -> String {
        for pointer in self.spec.error_pointers(&self.function) {
            let Some(Value::String(message)) = read_json_pointer(body, pointer) else { continue };
            if message.is_empty() {
                continue;
            }
            if self.spec.message_is_json(&self.function) {
                if let Some(Value::String(nested)) = read_json_pointer(&parse_body(message), "/message") {
                    return nested.clone();
                }
            }
            return message.clone();
        }
        match body {
            Value::String(text) if !text.is_empty() => text.clone(),
            _ => fallback,
        }
    }

    /// Read the page of a finished response
    fn read_page(&self, status: u16, body: Value, headers: Headers) -> Page {
        let rows = match (&self.function.rows, self.function.raw) {
            (Some(rows), false) => rows.clone(),
            _ => {
                let items = vec![if body.is_null() { Value::Object(Map::new()) } else { body.clone() }];
                return Page { status, items, meta: None, body, headers, unexpected: None };
            }
        };
        let items = read_json_pointer(&body, &rows).cloned();
        // An explicit null and an empty object are an empty list
        let is_empty = matches!(items, Some(Value::Null))
            || body.is_null()
            || matches!(&body, Value::Object(o) if o.is_empty())
            || matches!(&body, Value::Array(a) if a.is_empty());
        let items = match items {
            Some(Value::Array(items)) => items,
            _ if is_empty => Vec::new(),
            _ => return Page { status, items: Vec::new(), meta: None, unexpected: Some(body.clone()), body, headers },
        };
        let meta = match &body {
            Value::Object(object) if !rows.is_empty() => without_path(object, &json_pointer_segments(&rows)),
            _ => None,
        };
        Page { status, items, meta, body, headers, unexpected: None }
    }

    /// Read a response as a page, or fail
    fn finish_page(&self, response: HttpResponse) -> Result<Page, ClientFunctionError> {
        let body = parse_body(&response.text());
        let empty_on = self.function.errors.as_ref().and_then(|e| e.empty_on.as_ref());
        if empty_on.is_some_and(|statuses| statuses.contains(&response.status)) {
            return Ok(Page {
                status: response.status,
                items: Vec::new(),
                meta: None,
                body: Value::Null,
                headers: response.headers,
                unexpected: None,
            });
        }
        let fallback = format!("{} failed with the status {}", self.label(), response.status);
        if !response.ok() {
            return Err(ClientFunctionError::with_status(self.error_message(&body, fallback), response.status));
        }
        let error_if = self.function.errors.as_ref().and_then(|e| e.error_if.as_ref());
        if let Some(pointer) = error_if {
            if !is_empty_value(read_json_pointer(&body, pointer)) {
                return Err(ClientFunctionError::with_status(self.error_message(&body, fallback), response.status));
            }
        }
        Ok(self.read_page(response.status, body, response.headers))
    }

    /// A response arrived for the request that is out
    pub fn on_response(&mut self, response: HttpResponse, now: f64) -> Result<CallStep, ClientFunctionError> {
        if !matches!(self.phase, Phase::Sending) {
            return Err(ClientFunctionError::new(format!("{} got a response it didn't ask for", self.label())));
        }
        match self.pending.clone() {
            Some(pending) if response.status == pending.status => self.on_pending(pending, &response, now),
            _ => self.on_page(response, now),
        }
    }

    /// The response says that the call isn't finished
    fn on_pending(&mut self, pending: ClientFunctionPending, response: &HttpResponse, now: f64) -> Result<CallStep, ClientFunctionError> {
        let poll = match &pending.poll {
            ClientFunctionPoll::Header(header) => match response.header(header).filter(|v| !v.is_empty()) {
                Some(value) => value.to_string(),
                None => {
                    return Err(ClientFunctionError::with_status(
                        format!("{} answered {} without a {header} header", self.label(), response.status),
                        response.status,
                    ))
                }
            },
            ClientFunctionPoll::Repeat => POLL_SAME.to_string(),
            ClientFunctionPoll::Unknown(rule) => {
                return Err(ClientFunctionError::new(format!(
                    "{} has the unknown poll rule {}",
                    self.label(),
                    to_json_text(rule)
                )))
            }
        };
        let remaining = self.deadline - now;
        if remaining <= 0.0 {
            // The time ran out: only the first page can return the pending row
            if self.page_index > 0 {
                return Err(ClientFunctionError::with_status(
                    format!("{}: a later page is still running, use _wait", self.label()),
                    response.status,
                ));
            }
            self.phase = Phase::Done;
            let row = self.standard_row(response.status, None, Some(&poll), None, None);
            return Ok(CallStep::Done(ClientFunctionResult { fields: self.fields(), rows: vec![row] }));
        }
        let retry_after = response.header("Retry-After").map_or(0.0, |v| super::json::js_number_from_str(&v));
        let wait = if retry_after.is_finite() && retry_after > 0.0 { retry_after * 1000.0 } else { self.delay };
        self.delay = (self.delay * 2.0).min(POLL_MAX_MS);
        self.phase = Phase::Sleeping { poll };
        Ok(CallStep::Sleep { ms: wait.min(remaining) })
    }

    /// The wait before a poll is over
    pub fn on_wake(&mut self, _now: f64) -> Result<CallStep, ClientFunctionError> {
        let Phase::Sleeping { poll } = std::mem::replace(&mut self.phase, Phase::Sending) else {
            return Err(ClientFunctionError::new(format!("{} isn't waiting", self.label())));
        };
        if poll != POLL_SAME {
            self.current = follow_request(&self.page_request, &poll);
        }
        Ok(CallStep::Send(self.current.clone()))
    }

    /// A finished response of a page
    fn on_page(&mut self, response: HttpResponse, now: f64) -> Result<CallStep, ClientFunctionError> {
        let page = self.finish_page(response)?;
        let value = if page.unexpected.is_none() { self.next_value(&page)? } else { None };
        // A list that doesn't move on would repeat forever
        let previous = if self.page_index == 0 { self.next.as_ref().and_then(Value::as_str) } else { self.last_next.as_deref() };
        if value.is_some() && value.as_deref() == previous {
            return Err(ClientFunctionError::new(format!("{} returned the same next value twice", self.label())));
        }
        self.page_rows.push(page);
        self.last_next = value.clone();
        let Some(value) = value.filter(|_| self.page_index + 1 < self.pages) else {
            self.phase = Phase::Done;
            return Ok(CallStep::Done(self.result()));
        };
        // The next page of this call
        let Some(paging) = self.function.paging.clone() else {
            return Err(ClientFunctionError::new(format!("{} doesn't page", self.label())));
        };
        if paging.is_numeric() {
            self.position = super::json::js_number_from_str(&value);
        }
        let request = if paging.kind == "url" {
            follow_request(&self.page_request, &value)
        } else {
            let Some(option) = &paging.option else {
                return Err(ClientFunctionError::new(format!("{} names no option for its paging", self.label())));
            };
            let next = if paging.is_numeric() { number_value(js_number(&Value::String(value))) } else { Value::String(value) };
            self.send.insert(option.clone(), next);
            build_client_function_request(&self.spec, &self.function, &self.send, &lookup(&self.variables))?
        };
        self.page_index += 1;
        self.page_request = request.clone();
        self.current = request.clone();
        // A page waits as long as the first one while it's pending
        self.deadline = now + self.wait_seconds * 1000.0;
        self.delay = POLL_MIN_MS;
        self.phase = Phase::Sending;
        Ok(CallStep::Send(request))
    }

    /// The result of the pages. `_next` on every row holds the value after the last page. No row can't carry it, so an
    /// empty page with a next value still has one.
    fn result(&self) -> ClientFunctionResult {
        let next = self.last_next.as_deref();
        let mut rows = Vec::new();
        for page in &self.page_rows {
            for item in &page.items {
                rows.push(self.item_row(item, page, next));
            }
            if let Some(unexpected) = &page.unexpected {
                rows.push(self.standard_row(page.status, next, None, None, Some(unexpected)));
            }
        }
        if rows.is_empty() && (next.is_some() || self.function.paging.is_none()) {
            if let Some(last) = self.page_rows.last() {
                let meta = last.meta.clone().map(Value::Object);
                rows.push(self.standard_row(last.status, next, None, meta.as_ref(), None));
            }
        }
        ClientFunctionResult { fields: self.fields(), rows }
    }
}

/// The result of `EXPLAIN CALL`: the resolved request. It sends nothing, needs no credentials, and shows the name of the
/// host. A variable that the binding doesn't provide prints as `{name}`.
pub fn explain_client_function_call(
    spec: &ClientFunctionSpec,
    description: &ClientFunctionCallDescription,
    variables: &ClientFunctionVariables,
) -> Result<ClientFunctionResult, ClientFunctionError> {
    let function = spec.function(&description.function)?;
    description.require_values()?;
    let options = &description.options;
    let lookup = |name: &str| Some(variables.get(name).cloned().unwrap_or_else(|| format!("{{{name}}}")));
    let request = first_request(spec, function, options, &lookup)?;
    let standard: Map<String, Value> =
        options.iter().filter(|(name, _)| is_standard_option(name)).map(|(k, v)| (k.clone(), v.clone())).collect();
    let query = request.query.iter().map(|(name, value)| format!("{name}={value}")).collect::<Vec<_>>().join("&");
    let mut headers = Map::new();
    for (name, value) in &request.headers {
        headers.insert(name.clone(), Value::String(value.clone()));
    }
    let values: [(&str, Option<String>); 7] = [
        ("method", Some(request.method.clone())),
        ("host", Some(request.host.clone())),
        ("path", Some(request.follow_url.clone().unwrap_or(request.path.clone()))),
        ("query", (!query.is_empty()).then_some(query)),
        ("headers", (!headers.is_empty()).then(|| to_json_text(&Value::Object(headers)))),
        ("body", request.body.clone()),
        ("standard_options", (!standard.is_empty()).then(|| to_json_text(&Value::Object(standard)))),
    ];
    Ok(ClientFunctionResult {
        fields: values
            .iter()
            .map(|(name, _)| ResultField { name: name.to_string(), column_type: ColumnType::Varchar })
            .collect(),
        rows: vec![values.into_iter().map(|(_, value)| Cell::text(value)).collect()],
    })
}
