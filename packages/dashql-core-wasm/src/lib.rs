//! The wasm-bindgen API of the Rust core.
//!
//! Objects own their state; results are FlatBuffers returned as byte arrays, which the TypeScript
//! wrappers in `packages/dashql-core-js/src/api.ts` read with the generated FlatBuffers classes.
//! Errors become exceptions with the status code name or the error message.
//!
//! Scripts share their catalog through a reference-counted handle, so a script can outlive the JS
//! catalog object. Freeing a script or session releases its memory and leaves the catalog as it is: its owner
//! drops it from the catalog explicitly (`Catalog.dropScript`, `ScriptSession.dropFromCatalog`).

use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode, KeywordCase};
use dashql_core::catalog::{Catalog as CoreCatalog, CatalogLayer, EntryIdSource};
use dashql_core::completion::Completion;
use dashql_core::error::Error;
use dashql_core::annotation::Annotation;
use dashql_core::vis_rewrite::{VisBoard, VisFlow, VisRenderer};
use dashql_core::script::Script as CoreScript;
use dashql_core_session::script_session::ScriptSession as CoreScriptSession;
use std::cell::{Ref, RefCell, RefMut};
use std::rc::Rc;
use wasm_bindgen::prelude::*;

mod shell;

#[wasm_bindgen]
extern "C" {
    /// The panic listener that `installPanicHook` reports to, set by the JS wrapper
    #[wasm_bindgen(catch, js_namespace = globalThis, js_name = __dashqlCorePanic)]
    fn report_panic(message: &str) -> Result<(), JsValue>;
}

/// Report panics to `globalThis.__dashqlCorePanic` before the module traps.
///
/// A panic aborts: the call traps without dropping its guards, so the objects it borrowed stay borrowed and the
/// module must not be used anymore. JS sees only the trap, the hook tells it why.
#[wasm_bindgen(js_name = installPanicHook)]
pub fn install_panic_hook() {
    static INSTALLED: std::sync::Once = std::sync::Once::new();
    INSTALLED.call_once(|| {
        std::panic::set_hook(Box::new(|info| {
            // Without a listener the trap is all JS gets
            let _ = report_panic(&info.to_string());
        }));
    });
}

/// Convert a core error into a JS exception
fn js_error(error: Error) -> JsError {
    JsError::new(&error.message)
}

/// Read an annotation from its JSON
fn parse_annotation(json: &str) -> Result<Annotation, JsError> {
    serde_json::from_str(json).map_err(|e| JsError::new(&format!("invalid annotation: {e}")))
}

/// Finish a FlatBuffers object API value into bytes
macro_rules! finish {
    ($value:expr) => {{
        let mut builder = flatbuffers::FlatBufferBuilder::new();
        let packed = $value.pack(&mut builder);
        builder.finish(packed, None);
        builder.finished_data().to_vec()
    }};
}

/// A formatting config from the numeric arguments of the JS API
fn formatting_config(dialect: u8, mode: u8, max_width: u32, indentation_width: u32, debug_mode: bool, keyword_case: u8) -> FormattingConfigT {
    let mut config = FormattingConfigT::default();
    config.dialect = FormattingDialect(dialect);
    config.mode = FormattingMode(mode);
    config.max_width = max_width;
    config.indentation_width = indentation_width;
    config.debug_mode = debug_mode;
    config.keyword_case = KeywordCase(keyword_case);
    config
}

/// The catalog shared by the JS objects of the module: the catalog object and the scripts, sessions and
/// shells created on it. The JS objects are freed independently.
#[derive(Clone)]
pub struct SharedCatalog(Rc<RefCell<CoreCatalog>>);

impl SharedCatalog {
    fn new(catalog: CoreCatalog) -> Self {
        Self(Rc::new(RefCell::new(catalog)))
    }

    /// Read the catalog
    pub fn borrow(&self) -> Ref<'_, CoreCatalog> {
        self.0.borrow()
    }

    /// Modify the catalog
    pub fn borrow_mut(&self) -> RefMut<'_, CoreCatalog> {
        self.0.borrow_mut()
    }
}

thread_local! {
    /// The entry ids of all catalogs of the module, so a script key identifies a script across catalogs
    static ENTRY_IDS: EntryIdSource = EntryIdSource::new();
}

/// A catalog (`dashql_catalog_*`)
#[wasm_bindgen]
pub struct Catalog {
    /// The core catalog, shared with the scripts and sessions created on it
    inner: SharedCatalog,
}

#[wasm_bindgen]
impl Catalog {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Catalog {
        Catalog {
            inner: SharedCatalog::new(CoreCatalog::with_entry_ids(ENTRY_IDS.with(EntryIdSource::clone))),
        }
    }

    pub fn clear(&self) {
        self.inner.borrow_mut().clear();
    }

    /// The version of the catalog, every change of its contents bumps it. Sessions and shells change the catalog
    /// too, the version tells JS when its copies of the catalog are outdated.
    pub fn version(&self) -> u32 {
        self.inner.borrow().version()
    }

    #[wasm_bindgen(js_name = allocateEntryId)]
    pub fn allocate_entry_id(&self) -> u32 {
        self.inner.borrow().allocate_entry_id()
    }

    /// Publish descriptor bytes in a `CatalogLayer`
    #[wasm_bindgen(js_name = replaceDescriptor)]
    pub fn replace_descriptor(&self, id: u32, layer: u8, descriptor: &[u8]) -> Result<(), JsError> {
        self.inner.borrow_mut().replace_descriptor(id, CatalogLayer(layer), descriptor).map_err(js_error)
    }

    #[wasm_bindgen(js_name = dropDescriptor)]
    pub fn drop_descriptor(&self, id: u32) -> Result<(), JsError> {
        self.inner.borrow_mut().drop_descriptor(id).map_err(js_error)
    }

    /// Register client functions from their JSON spec and return their namespace. The namespace must be free.
    #[wasm_bindgen(js_name = registerClientFunctions)]
    pub fn register_client_functions(&self, spec: &str) -> Result<String, JsError> {
        self.inner.borrow_mut().register_client_functions(spec).map(|namespace| namespace.to_string()).map_err(js_error)
    }

    /// Drop the client functions of a namespace
    #[wasm_bindgen(js_name = dropClientFunctions)]
    pub fn drop_client_functions(&self, namespace: &str) {
        self.inner.borrow_mut().drop_client_functions(namespace);
    }

    /// Update the tables of a descriptor entry with a packed `CatalogTableUpdate`
    #[wasm_bindgen(js_name = replaceTables)]
    pub fn replace_tables(&self, id: u32, layer: u8, update: &[u8]) -> Result<(), JsError> {
        self.inner.borrow_mut().replace_tables(id, CatalogLayer(layer), update).map_err(js_error)
    }

    /// The relations that the connection reported as gone, as packed `TouchedRelations`
    #[wasm_bindgen(js_name = absentRelations)]
    pub fn absent_relations(&self) -> Vec<u8> {
        let mut out = dashql_buffers::catalog::TouchedRelationsT::default();
        out.relations = Some(self.inner.borrow().absent_relations().iter().map(|(database, schema, table)| {
            let mut name = dashql_buffers::analyzer::QualifiedTableNameT::default();
            name.database_name = Some(database.to_string());
            name.schema_name = Some(schema.to_string());
            name.table_name = Some(table.to_string());
            name
        }).collect());
        finish!(out)
    }

    /// The packed `CatalogDescriptor` of a descriptor entry
    #[wasm_bindgen(js_name = descriptorBytes)]
    pub fn descriptor_bytes(&self, id: u32) -> Option<Vec<u8>> {
        self.inner.borrow().descriptor_bytes(id).map(<[u8]>::to_vec)
    }

    #[wasm_bindgen(js_name = containsEntryId)]
    pub fn contains_entry_id(&self, id: u32) -> bool {
        self.inner.borrow().contains(id)
    }

    /// The `CatalogEntries` of all entries in rank order
    #[wasm_bindgen(js_name = describeEntries)]
    pub fn describe_entries(&self) -> Vec<u8> {
        finish!(self.inner.borrow().describe_entries())
    }

    /// The `CatalogEntries` of one entry, empty if the entry is unknown
    #[wasm_bindgen(js_name = describeEntriesOf)]
    pub fn describe_entries_of(&self, id: u32) -> Option<Vec<u8>> {
        self.inner.borrow().describe_entries_of(id).map(|e| finish!(e))
    }

    /// The `FlatCatalog`
    pub fn flatten(&self) -> Vec<u8> {
        finish!(self.inner.borrow().flatten())
    }

    /// The `CatalogStatistics`
    pub fn statistics(&self) -> Vec<u8> {
        finish!(self.inner.borrow().statistics())
    }

    /// Load the analysis of a script into a `CatalogLayer`
    #[wasm_bindgen(js_name = loadScript)]
    pub fn load_script(&self, script: &Script, layer: u8) -> Result<(), JsError> {
        let analyzed = script.inner.analyzed.clone().ok_or_else(|| js_error(Error::status(dashql_buffers::status::StatusCode::CATALOG_SCRIPT_NOT_ANALYZED)))?;
        self.inner.borrow_mut().load_script(analyzed, CatalogLayer(layer)).map_err(js_error)
    }

    /// Load the analyses of several scripts atomically
    #[wasm_bindgen(js_name = loadScripts)]
    pub fn load_scripts(&self, batch: &ScriptBatch) -> Result<(), JsError> {
        self.inner.borrow_mut().load_scripts(&batch.scripts).map_err(js_error)
    }

    /// Drop a script from the catalog
    #[wasm_bindgen(js_name = dropScript)]
    pub fn drop_script(&self, script: &Script) {
        self.inner.borrow_mut().drop_script(script.inner.catalog_entry_id());
    }
}

impl Default for Catalog {
    fn default() -> Self {
        Self::new()
    }
}

impl Catalog {
    /// The shared core catalog, for bindings of other crates in the same module (the shell)
    pub fn shared(&self) -> SharedCatalog {
        self.inner.clone()
    }
}

/// A batch of analyzed scripts for `Catalog::loadScripts`
#[wasm_bindgen]
pub struct ScriptBatch {
    /// The analyzed scripts with their catalog layers
    scripts: Vec<(std::sync::Arc<dashql_core::analyzer::AnalyzedScript>, CatalogLayer)>,
}

#[wasm_bindgen]
impl ScriptBatch {
    #[wasm_bindgen(constructor)]
    pub fn new() -> ScriptBatch {
        ScriptBatch { scripts: Vec::new() }
    }

    /// Add the analysis of a script in a `CatalogLayer`
    pub fn add(&mut self, script: &Script, layer: u8) -> Result<(), JsError> {
        let analyzed = script
            .inner
            .analyzed
            .clone()
            .ok_or_else(|| js_error(Error::status(dashql_buffers::status::StatusCode::CATALOG_SCRIPT_NOT_ANALYZED)))?;
        self.scripts.push((analyzed, CatalogLayer(layer)));
        Ok(())
    }
}

impl Default for ScriptBatch {
    fn default() -> Self {
        Self::new()
    }
}

/// A script (`dashql_script_*`)
#[wasm_bindgen]
pub struct Script {
    /// The catalog the script was created for
    catalog: SharedCatalog,
    /// The core script
    inner: CoreScript,
}

impl Script {
    fn format_with(&mut self, catalog: SharedCatalog, config: FormattingConfigT, parse_if_outdated: bool) -> Result<Script, JsError> {
        let text = self.inner.format(&config, parse_if_outdated).map_err(js_error)?;
        let mut inner = CoreScript::new(&catalog.borrow());
        inner.replace_text(&text);
        Ok(Script { catalog, inner })
    }
}

#[wasm_bindgen]
impl Script {
    #[wasm_bindgen(constructor)]
    pub fn new(catalog: &Catalog) -> Script {
        let inner = CoreScript::new(&catalog.inner.borrow());
        Script {
            catalog: catalog.inner.clone(),
            inner,
        }
    }

    #[wasm_bindgen(js_name = catalogEntryId)]
    pub fn catalog_entry_id(&self) -> u32 {
        self.inner.catalog_entry_id()
    }

    /// Insert text at a code point offset
    #[wasm_bindgen(js_name = insertTextAt)]
    pub fn insert_text_at(&mut self, offset: usize, text: &str) {
        self.inner.insert_text_at(offset, text);
    }

    /// Erase a code point range
    #[wasm_bindgen(js_name = eraseTextRange)]
    pub fn erase_text_range(&mut self, offset: usize, count: usize) {
        self.inner.erase_text_range(offset, count);
    }

    #[wasm_bindgen(js_name = replaceText)]
    pub fn replace_text(&mut self, text: &str) {
        self.inner.replace_text(text);
    }

    /// The text, or a byte range of it
    #[wasm_bindgen(js_name = toString)]
    pub fn to_text(&self, offset: Option<u32>, length: Option<u32>) -> String {
        match (offset, length) {
            (Some(offset), Some(length)) => self.inner.to_text_span(dashql_parser::span::TextSpan::new(offset, length)),
            _ => self.inner.to_text(),
        }
    }

    pub fn parse(&mut self) {
        self.inner.parse();
    }

    pub fn analyze(&mut self, parse_if_outdated: bool) -> Result<(), JsError> {
        let catalog = self.catalog.borrow();
        self.inner.analyze(&catalog, parse_if_outdated).map_err(js_error)
    }

    /// Does a statement of the parsed script start with a call in a namespace with client functions, even if it doesn't parse?
    #[wasm_bindgen(js_name = startsClientFunctionCall)]
    pub fn starts_client_function_call(&self) -> bool {
        let catalog = self.catalog.borrow();
        self.inner.parsed.as_ref().is_some_and(|parsed| dashql_core::analyzer::clfn_calls::starts_client_function_call(&parsed.scanned, &catalog))
    }

    /// The packed `ParsedScript`
    #[wasm_bindgen(js_name = getParsed)]
    pub fn get_parsed(&self) -> Result<Vec<u8>, JsError> {
        let parsed = self.inner.parsed.as_ref().ok_or_else(|| js_error(Error::status(dashql_buffers::status::StatusCode::SCRIPT_NOT_ANALYZED)))?;
        Ok(finish!(dashql_core::pack::pack_parsed_script(parsed)))
    }

    /// The packed `AnalyzedScript`
    #[wasm_bindgen(js_name = getAnalyzed)]
    pub fn get_analyzed(&self) -> Result<Vec<u8>, JsError> {
        let analyzed = self.inner.analyzed.as_ref().ok_or_else(|| js_error(Error::status(dashql_buffers::status::StatusCode::SCRIPT_NOT_ANALYZED)))?;
        Ok(finish!(dashql_core::pack::pack_analyzed_script(analyzed, &dashql_core_session::visualize::pack_visualization)))
    }

    /// The packed `ScriptDiff` from this script to a target script
    #[wasm_bindgen(js_name = computeDiff)]
    pub fn compute_diff(&self, target: &Script) -> Result<Vec<u8>, JsError> {
        let (Some(source), Some(target)) = (&self.inner.parsed, &target.inner.parsed) else {
            return Err(js_error(Error::status(dashql_buffers::status::StatusCode::SCRIPT_NOT_PARSED)));
        };
        let mut diff = dashql_core::script_diff::ScriptDiff::new(source, target);
        Ok(finish!(diff.pack()))
    }

    /// Move the cursor, returns the packed `ScriptCursor`
    #[wasm_bindgen(js_name = moveCursor)]
    pub fn move_cursor(&mut self, offset: usize) -> Vec<u8> {
        let catalog = self.catalog.borrow();
        let cursor = self.inner.move_cursor(&catalog, offset);
        finish!(dashql_core::pack::pack_cursor(&cursor))
    }

    /// Complete at the cursor, returns the packed `Completion`
    #[wasm_bindgen(js_name = completeAtCursor)]
    pub fn complete_at_cursor(&self, limit: usize, keyword_case: u8) -> Result<Vec<u8>, JsError> {
        let catalog = self.catalog.borrow();
        let cursor = self
            .inner
            .cursor(&catalog)
            .ok_or_else(|| js_error(Error::status(dashql_buffers::status::StatusCode::COMPLETION_MISSES_CURSOR)))?;
        if cursor.scanner_location.is_none() {
            return Err(js_error(Error::status(dashql_buffers::status::StatusCode::COMPLETION_MISSES_SCANNER_TOKEN)));
        }
        let completion = Completion::compute(&cursor, limit);
        Ok(finish!(dashql_core::pack::pack_completion(&completion, KeywordCase(keyword_case) == KeywordCase::UPPER)))
    }

    /// Compile the script into the packed `ScriptCompilationResult`
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = compileQuery)]
    pub fn compile_query(
        &mut self,
        dialect: u8,
        mode: u8,
        max_width: u32,
        indentation_width: u32,
        allow_extensions: bool,
        parse_if_outdated: bool,
    ) -> Vec<u8> {
        let config = formatting_config(dialect, mode, max_width, indentation_width, false, 0);
        let options = dashql_core_session::compiler::CompilationOptions {
            allow_extensions,
            parse_if_outdated,
        };
        let catalog = self.catalog.borrow();
        finish!(dashql_core_session::compiler::compile(&mut self.inner, &catalog, &config, options))
    }

    /// The first parsed statement without its separator or surrounding trivia
    #[wasm_bindgen(js_name = getStatementText)]
    pub fn get_statement_text(&mut self, parse_if_outdated: bool) -> Result<String, JsError> {
        self.inner.statement_text(parse_if_outdated).map_err(js_error)
    }

    /// Visualize the terminal query with a Vega-Lite spec in the text of the script, returns the UTF-8 offset
    /// and length of the written tag
    #[wasm_bindgen(js_name = rewriteVegaLite)]
    pub fn rewrite_vegalite(&mut self, spec: &str, parse_if_outdated: bool) -> Result<Vec<u32>, JsError> {
        let (text, tag) = self.inner.rewrite_vegalite(spec, parse_if_outdated).map_err(js_error)?;
        self.inner.replace_text(&text);
        Ok(vec![tag.offset, tag.length])
    }

    /// The annotation of a statement as JSON, `{"preamble": [...], "tags": [{"name": ..., "lines": [...]}]}`
    #[wasm_bindgen(js_name = readAnnotation)]
    pub fn read_annotation(&mut self, statement_id: u32, parse_if_outdated: bool) -> Result<String, JsError> {
        let annotation = self.inner.read_annotation(statement_id as usize, parse_if_outdated).map_err(js_error)?;
        serde_json::to_string(&annotation).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Replace the annotation of a statement, given as JSON like `readAnnotation` returns it. Returns the new
    /// text, the script is not changed.
    #[wasm_bindgen(js_name = rewriteAnnotation)]
    pub fn rewrite_annotation(&mut self, statement_id: u32, annotation: &str, parse_if_outdated: bool) -> Result<String, JsError> {
        let annotation = parse_annotation(annotation)?;
        self.inner.rewrite_annotation(statement_id as usize, &annotation, parse_if_outdated).map_err(js_error)
    }

    /// The packed `ScriptStatistics`
    #[wasm_bindgen(js_name = getStatistics)]
    pub fn get_statistics(&self) -> Vec<u8> {
        finish!(self.inner.statistics())
    }

    /// Format the script into a new script of the catalog of this script
    #[allow(clippy::too_many_arguments)]
    pub fn format(
        &mut self,
        dialect: u8,
        mode: u8,
        max_width: u32,
        indentation_width: u32,
        debug_mode: bool,
        keyword_case: u8,
        parse_if_outdated: bool,
    ) -> Result<Script, JsError> {
        let catalog = self.catalog.clone();
        self.format_with(catalog, formatting_config(dialect, mode, max_width, indentation_width, debug_mode, keyword_case), parse_if_outdated)
    }

    /// Format the script into a new script of another catalog
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = formatInto)]
    pub fn format_into(
        &mut self,
        dialect: u8,
        mode: u8,
        max_width: u32,
        indentation_width: u32,
        debug_mode: bool,
        keyword_case: u8,
        parse_if_outdated: bool,
        catalog: &Catalog,
    ) -> Result<Script, JsError> {
        let config = formatting_config(dialect, mode, max_width, indentation_width, debug_mode, keyword_case);
        self.format_with(catalog.inner.clone(), config, parse_if_outdated)
    }

    /// The AST node ids that formatting cannot represent
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = getUnformattableNodes)]
    pub fn get_unformattable_nodes(
        &mut self,
        dialect: u8,
        mode: u8,
        max_width: u32,
        indentation_width: u32,
        debug_mode: bool,
        parse_if_outdated: bool,
    ) -> Result<Vec<u32>, JsError> {
        let config = formatting_config(dialect, mode, max_width, indentation_width, debug_mode, 0);
        self.inner.unformattable_nodes(&config, parse_if_outdated).map_err(js_error)
    }

    /// Can formatting represent every node?
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = isFullyFormattable)]
    pub fn is_fully_formattable(
        &mut self,
        dialect: u8,
        mode: u8,
        max_width: u32,
        indentation_width: u32,
        debug_mode: bool,
        parse_if_outdated: bool,
    ) -> Result<bool, JsError> {
        let config = formatting_config(dialect, mode, max_width, indentation_width, debug_mode, 0);
        self.inner.is_fully_formattable(&config, parse_if_outdated).map_err(js_error)
    }
}

/// An editor session (`dashql_script_session_*`). Shared, so that session lists can refer to it.
#[wasm_bindgen]
pub struct ScriptSession {
    /// The catalog of the session
    catalog: SharedCatalog,
    /// The core session, shared with the session lists it was added to
    inner: Rc<RefCell<CoreScriptSession>>,
}

impl ScriptSession {
    fn format_with(&self, catalog: SharedCatalog, config: FormattingConfigT, parse_if_outdated: bool) -> Result<Script, JsError> {
        let inner = self.inner.borrow_mut().format(&catalog.borrow(), &config, parse_if_outdated).map_err(js_error)?;
        Ok(Script { catalog, inner })
    }
}

#[wasm_bindgen]
impl ScriptSession {
    #[wasm_bindgen(constructor)]
    pub fn new(catalog: &Catalog, offset_unit: u8) -> Result<ScriptSession, JsError> {
        let session =
            CoreScriptSession::new(&catalog.inner.borrow(), dashql_buffers::editor::EditorOffsetUnit(offset_unit)).map_err(js_error)?;
        Ok(ScriptSession {
            catalog: catalog.inner.clone(),
            inner: Rc::new(RefCell::new(session)),
        })
    }

    /// A session whose script takes an entry id that the catalogs of the module allocated before
    #[wasm_bindgen(js_name = withEntryId)]
    pub fn with_entry_id(catalog: &Catalog, offset_unit: u8, entry_id: u32) -> Result<ScriptSession, JsError> {
        let session =
            CoreScriptSession::with_entry_id(&catalog.inner.borrow(), dashql_buffers::editor::EditorOffsetUnit(offset_unit), entry_id)
                .map_err(js_error)?;
        Ok(ScriptSession {
            catalog: catalog.inner.clone(),
            inner: Rc::new(RefCell::new(session)),
        })
    }

    #[wasm_bindgen(js_name = catalogEntryId)]
    pub fn catalog_entry_id(&self) -> u32 {
        self.inner.borrow().catalog_entry_id()
    }

    pub fn text(&self) -> String {
        self.inner.borrow().text()
    }

    #[wasm_bindgen(js_name = textVersion)]
    pub fn text_version(&self) -> u64 {
        self.inner.borrow().text_version()
    }

    #[wasm_bindgen(js_name = stateRevision)]
    pub fn state_revision(&self) -> u64 {
        self.inner.borrow().state_revision()
    }

    #[wasm_bindgen(js_name = catalogRevision)]
    pub fn catalog_revision(&self) -> u64 {
        self.catalog.borrow().version() as u64
    }

    /// Replace the text, returns the packed `EditorUpdate`
    #[wasm_bindgen(js_name = replaceText)]
    pub fn replace_text(&self, expected_text_version: u64, text: &str) -> Vec<u8> {
        finish!(self.inner.borrow_mut().replace_text(&self.catalog.borrow(), expected_text_version, text))
    }

    /// Apply a packed `EditorEvent`, returns the packed `EditorUpdate`
    pub fn apply(&self, event: &[u8]) -> Vec<u8> {
        finish!(self.inner.borrow_mut().apply_buffer(&self.catalog.borrow(), event))
    }

    /// Move the primary cursor, returns the packed `EditorUpdate`
    #[wasm_bindgen(js_name = setPrimaryCursor)]
    pub fn set_primary_cursor(&self, expected_text_version: u64, offset: u64) -> Vec<u8> {
        finish!(self.inner.borrow_mut().set_primary_cursor(&self.catalog.borrow(), expected_text_version, offset))
    }

    /// Analyze, returns the packed `EditorUpdate`
    pub fn analyze(&self) -> Vec<u8> {
        finish!(self.inner.borrow_mut().analyze(&self.catalog.borrow()))
    }

    /// The named table parameters of the analysis that reference scripts, with the script that each finds among
    /// `names`: triples of the offset, the length and the script index (u32::MAX if none), in the offset unit
    #[wasm_bindgen(js_name = findScriptReferences)]
    pub fn find_script_references(&self, names: Vec<String>) -> Vec<u32> {
        let mut out = Vec::new();
        for (span, script) in self.inner.borrow().script_references(&names) {
            out.extend([span.offset as u32, span.length as u32, script.map(|s| s as u32).unwrap_or(u32::MAX)]);
        }
        out
    }

    /// Complete at the primary cursor, returns the packed `Completion`
    #[wasm_bindgen(js_name = completeAtCursor)]
    pub fn complete_at_cursor(&self, limit: usize, keyword_case: u8) -> Result<Vec<u8>, JsError> {
        let completion = self.inner.borrow().complete(&self.catalog.borrow(), limit, KeywordCase(keyword_case)).map_err(js_error)?;
        Ok(finish!(completion))
    }

    /// Compile the script, returns the packed `ScriptCompilationResult`
    #[wasm_bindgen(js_name = compileQuery)]
    pub fn compile_query(
        &self,
        dialect: u8,
        mode: u8,
        max_width: u32,
        indentation_width: u32,
        allow_extensions: bool,
        parse_if_outdated: bool,
    ) -> Vec<u8> {
        let config = formatting_config(dialect, mode, max_width, indentation_width, false, 0);
        finish!(self.inner.borrow_mut().compile_query(&self.catalog.borrow(), &config, allow_extensions, parse_if_outdated))
    }

    /// Format the script into a new script of the session catalog
    #[allow(clippy::too_many_arguments)]
    pub fn format(
        &self,
        dialect: u8,
        mode: u8,
        max_width: u32,
        indentation_width: u32,
        debug_mode: bool,
        keyword_case: u8,
        parse_if_outdated: bool,
    ) -> Result<Script, JsError> {
        self.format_with(self.catalog.clone(), formatting_config(dialect, mode, max_width, indentation_width, debug_mode, keyword_case), parse_if_outdated)
    }

    /// Format the script into a new script of another catalog
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = formatInto)]
    pub fn format_into(
        &self,
        dialect: u8,
        mode: u8,
        max_width: u32,
        indentation_width: u32,
        debug_mode: bool,
        keyword_case: u8,
        parse_if_outdated: bool,
        catalog: &Catalog,
    ) -> Result<Script, JsError> {
        let config = formatting_config(dialect, mode, max_width, indentation_width, debug_mode, keyword_case);
        self.format_with(catalog.inner.clone(), config, parse_if_outdated)
    }

    /// The annotation of a statement as JSON, like `Script.readAnnotation`
    #[wasm_bindgen(js_name = readAnnotation)]
    pub fn read_annotation(&self, statement_id: u32, parse_if_outdated: bool) -> Result<String, JsError> {
        let annotation = self.inner.borrow_mut().read_annotation(statement_id as usize, parse_if_outdated).map_err(js_error)?;
        serde_json::to_string(&annotation).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Replace the annotation of a statement, given as JSON. Returns the new text.
    #[wasm_bindgen(js_name = rewriteAnnotation)]
    pub fn rewrite_annotation(&self, statement_id: u32, annotation: &str, parse_if_outdated: bool) -> Result<String, JsError> {
        let annotation = parse_annotation(annotation)?;
        self.inner.borrow_mut().rewrite_annotation(statement_id as usize, &annotation, parse_if_outdated).map_err(js_error)
    }

    /// Set the `@board` tag of a query, negative rows and columns are absent. Returns the new text.
    #[wasm_bindgen(js_name = rewriteVisBoard)]
    pub fn rewrite_vis_board(
        &self,
        statement_id: u32,
        row: i32,
        column: i32,
        width: i32,
        height: i32,
        parse_if_outdated: bool,
    ) -> Result<String, JsError> {
        let board = VisBoard { row: (row >= 0).then_some(row), column: (column >= 0).then_some(column), width, height };
        self.inner.borrow_mut().rewrite_vis_board(statement_id as usize, Some(&board), parse_if_outdated).map_err(js_error)
    }

    /// Set the `@flow` tag of the script, its placement on the dataflow canvas: the position if both coordinates are
    /// given, the width of the box and the height of its chart if given. Returns the new text.
    #[wasm_bindgen(js_name = rewriteVisFlow)]
    pub fn rewrite_vis_flow(
        &self,
        x: Option<i32>,
        y: Option<i32>,
        width: Option<i32>,
        height: Option<i32>,
        parse_if_outdated: bool,
    ) -> Result<String, JsError> {
        let flow = VisFlow { position: x.zip(y), width, height };
        self.inner.borrow_mut().rewrite_vis_flow(Some(&flow), parse_if_outdated).map_err(js_error)
    }

    /// Remove the `@flow` tag of the script. Returns the new text.
    #[wasm_bindgen(js_name = removeVisFlow)]
    pub fn remove_vis_flow(&self, parse_if_outdated: bool) -> Result<String, JsError> {
        self.inner.borrow_mut().rewrite_vis_flow(None, parse_if_outdated).map_err(js_error)
    }

    /// Set the `@param` tag of an input of the script, its value. Returns the new text.
    #[wasm_bindgen(js_name = rewriteParamTag)]
    pub fn rewrite_param_tag(&self, name: &str, value: &str, parse_if_outdated: bool) -> Result<String, JsError> {
        self.inner.borrow_mut().rewrite_param_tag(name, Some(value), parse_if_outdated).map_err(js_error)
    }

    /// Remove the `@param` tags of an input of the script. Returns the new text.
    #[wasm_bindgen(js_name = removeParamTag)]
    pub fn remove_param_tag(&self, name: &str, parse_if_outdated: bool) -> Result<String, JsError> {
        self.inner.borrow_mut().rewrite_param_tag(name, None, parse_if_outdated).map_err(js_error)
    }

    /// Set the renderer tag of a query (`vegalite` with a JSON object, `markdown` with a template or
    /// `table`), an empty kind removes it. Returns the new text.
    #[wasm_bindgen(js_name = rewriteVisRenderer)]
    pub fn rewrite_vis_renderer(&self, statement_id: u32, kind: &str, body: &str, parse_if_outdated: bool) -> Result<String, JsError> {
        let renderer = (!kind.is_empty()).then(|| VisRenderer::from_parts(kind, body)).transpose().map_err(js_error)?;
        self.inner.borrow_mut().rewrite_vis_renderer(statement_id as usize, renderer.as_ref(), parse_if_outdated).map_err(js_error)
    }

    /// Can formatting represent every node?
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = isFullyFormattable)]
    pub fn is_fully_formattable(
        &self,
        dialect: u8,
        mode: u8,
        max_width: u32,
        indentation_width: u32,
        debug_mode: bool,
        parse_if_outdated: bool,
    ) -> Result<bool, JsError> {
        let config = formatting_config(dialect, mode, max_width, indentation_width, debug_mode, 0);
        self.inner.borrow_mut().is_fully_formattable(&config, parse_if_outdated).map_err(js_error)
    }

    /// The packed `ScriptDiff` from the session script to a target script
    #[wasm_bindgen(js_name = computeDiff)]
    pub fn compute_diff(&self, target: &Script) -> Result<Vec<u8>, JsError> {
        let diff = self.inner.borrow().diff(&target.inner).map_err(js_error)?;
        Ok(finish!(diff))
    }

    /// Publish the analysis into the session layer of the catalog
    #[wasm_bindgen(js_name = loadIntoCatalog)]
    pub fn load_into_catalog(&self) -> Result<(), JsError> {
        self.inner.borrow_mut().load_into_catalog(&mut self.catalog.borrow_mut(), CatalogLayer::SESSION).map_err(js_error)
    }

    #[wasm_bindgen(js_name = dropFromCatalog)]
    pub fn drop_from_catalog(&self) {
        self.inner.borrow().drop_from_catalog(&mut self.catalog.borrow_mut());
    }
}

/// A request to plan the scripts of a session across connections (`planner::SessionPlanRequest`)
#[wasm_bindgen]
pub struct SessionPlanRequest {
    /// The connections: the host id, whether it is the LOCAL connection, its catalog, its formatting dialect and
    /// the database and schema of relations without those names
    connections: Vec<(String, bool, SharedCatalog, u8, String, String)>,
    /// The scripts in session order: the name, the connection index, the session and the name of the file of a
    /// materialized result
    scripts: Vec<(String, u32, Rc<RefCell<CoreScriptSession>>, Option<String>)>,
    /// The target scripts, the whole session if absent
    targets: Option<Vec<u32>>,
    /// The scripts whose materialized results the host provides
    materialized: Vec<u32>,
    /// The directory the host mounts materialized results in
    mount_prefix: String,
    /// The attachments: the name, the file name, the stamp of the file and its columns if the host read them
    attachments: Vec<(String, String, String, Option<Vec<std::sync::Arc<str>>>)>,
    /// The directory the host mounts the attachments in
    attachment_prefix: String,
}

#[wasm_bindgen]
impl SessionPlanRequest {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SessionPlanRequest {
        SessionPlanRequest {
            connections: Vec::new(),
            scripts: Vec::new(),
            targets: None,
            materialized: Vec::new(),
            mount_prefix: String::new(),
            attachments: Vec::new(),
            attachment_prefix: String::new(),
        }
    }

    /// Add a connection, returns its index
    #[wasm_bindgen(js_name = addConnection)]
    pub fn add_connection(&mut self, id: String, local: bool, catalog: &Catalog, dialect: u8, default_database: String, default_schema: String) -> u32 {
        self.connections.push((id, local, catalog.inner.clone(), dialect, default_database, default_schema));
        (self.connections.len() - 1) as u32
    }

    /// Add a script in session order, returns its index. A materialized result of the script is written to
    /// `materialization_file` below the mount prefix, `s<index>.parquet` if absent.
    #[wasm_bindgen(js_name = addScript)]
    pub fn add_script(&mut self, name: String, connection: u32, session: &ScriptSession, materialization_file: Option<String>) -> u32 {
        self.scripts.push((name, connection, session.inner.clone(), materialization_file));
        (self.scripts.len() - 1) as u32
    }

    /// Add an attachment, a Parquet file of the session that the table parameter `:name` reads, returns its index. The
    /// stamp changes when the file changes, e.g. its size and modification time. The columns are absent if the host
    /// didn't read them yet.
    #[wasm_bindgen(js_name = addAttachment)]
    pub fn add_attachment(&mut self, name: String, file: String, stamp: String, columns: Option<Vec<String>>) -> u32 {
        let columns = columns.map(|columns| columns.into_iter().map(std::sync::Arc::from).collect());
        self.attachments.push((name, file, stamp, columns));
        (self.attachments.len() - 1) as u32
    }

    /// Plan the target scripts and what they need instead of the whole session
    #[wasm_bindgen(js_name = setTargets)]
    pub fn set_targets(&mut self, targets: Vec<u32>) {
        self.targets = Some(targets);
    }

    /// The scripts whose materialized results the host provides
    #[wasm_bindgen(js_name = setMaterialized)]
    pub fn set_materialized(&mut self, materialized: Vec<u32>) {
        self.materialized = materialized;
    }

    /// The directory the host mounts materialized results in
    #[wasm_bindgen(js_name = setMountPrefix)]
    pub fn set_mount_prefix(&mut self, prefix: String) {
        self.mount_prefix = prefix;
    }

    /// The directory the host mounts the attachments in
    #[wasm_bindgen(js_name = setAttachmentPrefix)]
    pub fn set_attachment_prefix(&mut self, prefix: String) {
        self.attachment_prefix = prefix;
    }
}

impl Default for SessionPlanRequest {
    fn default() -> Self {
        Self::new()
    }
}

/// Borrow the catalogs and sessions of a request and pass the core request to `f`
fn with_session_plan_request<R>(
    request: &SessionPlanRequest,
    f: impl FnOnce(&dashql_core_session::planner::SessionPlanRequest, &[std::cell::Ref<CoreScriptSession>]) -> R,
) -> R {
    use dashql_core_session::planner::{ConnectionKind, PlanScope, PlannerAttachment, PlannerConnection, PlannerScript};
    let catalogs: Vec<_> = request.connections.iter().map(|(_, _, catalog, _, _, _)| catalog.borrow()).collect();
    let sessions: Vec<_> = request.scripts.iter().map(|(_, _, session, _)| session.borrow()).collect();
    let connections: Vec<_> = request
        .connections
        .iter()
        .zip(&catalogs)
        .map(|((id, local, _, dialect, default_database, default_schema), catalog)| PlannerConnection {
            id,
            kind: if *local { ConnectionKind::Local } else { ConnectionKind::Remote },
            catalog,
            dialect: dashql_buffers::formatting::FormattingDialect(*dialect),
            default_database,
            default_schema,
        })
        .collect();
    let scripts: Vec<_> = request
        .scripts
        .iter()
        .zip(&sessions)
        .map(|((name, connection, _, file), session)| PlannerScript {
            script: session.script(),
            name,
            connection: *connection,
            materialization_file: file.as_deref(),
        })
        .collect();
    let attachments: Vec<_> =
        request.attachments.iter().map(|(name, file, stamp, _)| PlannerAttachment { name, file, stamp }).collect();
    let scope = match &request.targets {
        Some(targets) => PlanScope::Targets(targets),
        None => PlanScope::Session,
    };
    let core = dashql_core_session::planner::SessionPlanRequest {
        connections: &connections,
        scripts: &scripts,
        scope,
        materialized: &request.materialized,
        mount_prefix: &request.mount_prefix,
        attachments: &attachments,
        attachment_prefix: &request.attachment_prefix,
    };
    f(&core, &sessions)
}

/// Plan the current analysis of the scripts of a session across connections, returns the packed `ExecutionGraph`
#[wasm_bindgen(js_name = planSession)]
pub fn plan_session(request: &SessionPlanRequest) -> Vec<u8> {
    with_session_plan_request(request, |core, _| finish!(dashql_core_session::planner::plan_session(core)))
}

/// Check the script references of the scripts of a session, returns the packed `ScriptReferenceCheck`. The text spans
/// are in the offset unit of the session of each script. Ignores the targets, the materialized scripts and the mount
/// prefix.
#[wasm_bindgen(js_name = checkScriptReferences)]
pub fn check_script_references(request: &SessionPlanRequest) -> Vec<u8> {
    use dashql_buffers::execution::{CheckedScriptReferenceT, CheckedScriptT, ScriptReferenceCheckT, ScriptReferenceKind, TableParameterCollisionT};
    use dashql_core_session::script_references::ReferenceKind;
    with_session_plan_request(request, |core, sessions| {
        let checked = dashql_core_session::script_references::check_script_references(core);
        let mut out = ScriptReferenceCheckT::default();
        let scripts = checked
            .into_iter()
            .zip(sessions)
            .map(|(script, session)| {
                let spans = session.project_text_spans(script.references.iter().map(|r| r.text_span));
                let mut packed = CheckedScriptT::default();
                packed.checked = script.checked;
                packed.text_version = script.text_version;
                let references: Vec<_> = script
                    .references
                    .into_iter()
                    .zip(spans)
                    .filter_map(|(r, span)| {
                        let span = span?;
                        let mut t = CheckedScriptReferenceT::default();
                        let mut text_span = dashql_buffers::parser::TextSpanT::default();
                        text_span.offset = span.offset as u32;
                        text_span.length = span.length as u32;
                        t.text_span = Some(text_span);
                        t.parameter = Some(r.parameter);
                        t.script = r.script.unwrap_or(u32::MAX);
                        t.attachment = r.attachment.unwrap_or(u32::MAX);
                        t.kind = match r.kind {
                            ReferenceKind::Inline => ScriptReferenceKind::INLINE,
                            ReferenceKind::Scan => ScriptReferenceKind::SCAN,
                            ReferenceKind::Invalid => ScriptReferenceKind::INVALID,
                            ReferenceKind::Attachment => ScriptReferenceKind::ATTACHMENT,
                        };
                        t.errors = (!r.errors.is_empty()).then_some(r.errors);
                        Some(t)
                    })
                    .collect();
                packed.references = (!references.is_empty()).then_some(references);
                packed
            })
            .collect();
        out.scripts = Some(scripts);
        let collisions: Vec<_> = dashql_core_session::script_references::table_parameter_collisions(core)
            .into_iter()
            .map(|c| {
                let mut t = TableParameterCollisionT::default();
                t.name = Some(c.name);
                t.scripts = Some(c.scripts);
                t.attachments = Some(c.attachments);
                t
            })
            .collect();
        out.collisions = (!collisions.is_empty()).then_some(collisions);
        finish!(out)
    })
}

/// Derive the dataflow of the scripts of a session (`dataflow::derive_session_dataflow`), returns the packed
/// `SessionDataflow`. The text spans are in the offset unit of the session of each script.
#[wasm_bindgen(js_name = deriveSessionDataflow)]
pub fn derive_session_dataflow(request: &SessionPlanRequest) -> Vec<u8> {
    use dashql_buffers::execution::{DataflowEdgeKind, DataflowEdgeT, DataflowScriptT, DataflowStatementT, SessionDataflowT};
    use dashql_core_session::dataflow::DataflowEdgeKind as Kind;
    with_session_plan_request(request, |core, sessions| {
        let dataflow = dashql_core_session::dataflow::derive_session_dataflow(core);
        let mut out = SessionDataflowT::default();
        out.scripts = Some(
            dataflow
                .scripts
                .into_iter()
                .zip(sessions)
                .map(|(script, session)| {
                    let spans = session.project_text_spans(script.statements.iter().map(|s| s.text_span));
                    let mut packed = DataflowScriptT::default();
                    packed.analyzed = script.analyzed;
                    packed.text_version = script.text_version;
                    packed.manual = script.manual;
                    let statements: Vec<_> = script
                        .statements
                        .into_iter()
                        .zip(spans)
                        .map(|(statement, span)| {
                            let mut t = DataflowStatementT::default();
                            t.statement_type = statement.statement_type;
                            t.target = statement.target;
                            t.text_span = span.map(|span| {
                                let mut text_span = dashql_buffers::parser::TextSpanT::default();
                                text_span.offset = span.offset as u32;
                                text_span.length = span.length as u32;
                                text_span
                            });
                            t
                        })
                        .collect();
                    packed.statements = (!statements.is_empty()).then_some(statements);
                    packed
                })
                .collect(),
        );
        let edges: Vec<_> = dataflow
            .edges
            .into_iter()
            .map(|e| {
                let mut t = DataflowEdgeT::default();
                t.from_script = e.from.script;
                t.from_statement = e.from.statement;
                t.to_script = e.to.script;
                t.to_statement = e.to.statement;
                t.kind = match e.kind {
                    Kind::InlineReference => DataflowEdgeKind::INLINE_REFERENCE,
                    Kind::ScanReference => DataflowEdgeKind::SCAN_REFERENCE,
                    Kind::InvalidReference => DataflowEdgeKind::INVALID_REFERENCE,
                    Kind::Table => DataflowEdgeKind::TABLE,
                    Kind::Input => DataflowEdgeKind::INPUT,
                    Kind::Attachment => DataflowEdgeKind::ATTACHMENT,
                };
                t.name = Some(e.name);
                t
            })
            .collect();
        out.edges = (!edges.is_empty()).then_some(edges);
        let inputs: Vec<_> = dataflow
            .inputs
            .into_iter()
            .map(|input| pack_session_input(&input))
            .collect();
        out.inputs = (!inputs.is_empty()).then_some(inputs);
        let attachments: Vec<_> = dataflow
            .attachments
            .into_iter()
            .map(|a| {
                let mut t = dashql_buffers::execution::DataflowAttachmentT::default();
                t.name = Some(a.name);
                t.file = Some(a.file);
                t
            })
            .collect();
        out.attachments = (!attachments.is_empty()).then_some(attachments);
        finish!(out)
    })
}

/// Pack an input of a session
fn pack_session_input(input: &dashql_core_session::session_inputs::SessionInput) -> dashql_buffers::execution::SessionInputT {
    use dashql_buffers::execution::{SessionInputConsumerT, SessionInputT, SessionInputTypeSource};
    use dashql_core_session::session_inputs::InputTypeSource;
    let (consumers, warnings, literal) = (&input.consumers, &input.warnings, input.literal.as_ref());
    let mut out = SessionInputT::default();
    out.name = Some(input.name.to_string());
    out.sql_type = Some(Box::new(dashql_core::pack::pack_sql_type(&input.sql_type)));
    out.type_source = match input.type_source {
        InputTypeSource::Cast => SessionInputTypeSource::CAST,
        InputTypeSource::Literal => SessionInputTypeSource::LITERAL,
        InputTypeSource::None => SessionInputTypeSource::NONE,
    };
    out.has_value = literal.is_some();
    out.literal = literal.map(|l| l.to_hyper());
    out.value = literal.map(|l| l.display_value());
    out.consumers = (!consumers.is_empty()).then(|| consumers
            .iter()
            .map(|c| {
                let mut t = SessionInputConsumerT::default();
                t.script = c.script;
                t.statement = c.statement;
                t
            })
            .collect());
    out.warnings = (!warnings.is_empty()).then(|| warnings.to_vec());
    out
}

/// The literal of the value of an input control, in the Hyper dialect: `sql_type` is the SQL text of the type of the
/// input, `SqlType.sql`, absent without a type
#[wasm_bindgen(js_name = inputLiteral)]
pub fn input_literal(value: &str, sql_type: Option<String>) -> Result<String, JsError> {
    let ty = sql_type.as_deref().and_then(dashql_core::analyzer::sql_types::parse_sql_type);
    dashql_core::sql_literal::SqlLiteral::from_value(value, ty.as_ref()).map(|l| l.to_hyper()).map_err(|e| JsError::new(&e))
}

/// Collect the inputs of the scripts of a session (`session_inputs::collect_session_inputs`), returns the packed
/// `SessionInputs`. Ignores the targets, the materialized scripts and the mount prefix.
#[wasm_bindgen(js_name = collectSessionInputs)]
pub fn collect_session_inputs(request: &SessionPlanRequest) -> Vec<u8> {
    with_session_plan_request(request, |core, _| {
        let inputs = dashql_core_session::session_inputs::collect_session_inputs(core);
        let mut out = dashql_buffers::execution::SessionInputsT::default();
        out.inputs = Some(
            inputs
                .inputs
                .iter()
                .map(pack_session_input)
                .collect(),
        );
        finish!(out)
    })
}

/// The table parameters of a session (`table_parameters::TableParameters`)
#[wasm_bindgen]
pub struct TableParameters {
    /// The published table parameters
    current: RefCell<Option<std::sync::Arc<dashql_core::table_parameters::TableParameters>>>,
}

#[wasm_bindgen]
impl TableParameters {
    #[wasm_bindgen(constructor)]
    pub fn new() -> TableParameters {
        TableParameters { current: RefCell::new(None) }
    }

    /// Derive the table parameters from the analyses of the scripts and the attachments of a request and give them to
    /// the sessions of the scripts. Returns the indexes of the scripts whose analysis is outdated by them, every script
    /// if they changed. A script whose analysis lags behind its text keeps its previous result.
    pub fn publish(&self, request: &SessionPlanRequest) -> Vec<u32> {
        use dashql_core::table_parameters::TableParameters as CoreResults;
        let previous = self.current.borrow().clone();
        let derived = {
            let sessions: Vec<_> = request.scripts.iter().map(|(_, _, session, _)| session.borrow()).collect();
            let inputs: Vec<(&str, Option<&dashql_core::analyzer::AnalyzedScript>)> = request
                .scripts
                .iter()
                .zip(&sessions)
                .map(|((name, _, _, _), session)| {
                    let script = session.script();
                    (name.as_str(), script.current_analysis().map(|(_, _, analyzed)| analyzed.as_ref()))
                })
                .collect();
            let attachments: Vec<_> = request
                .attachments
                .iter()
                .map(|(name, _, _, columns)| dashql_core::table_parameters::TableParameterAttachment { name, columns: columns.as_deref() })
                .collect();
            CoreResults::derive(&inputs, &attachments, previous.as_deref())
        };
        let results = match previous {
            Some(previous) if previous.same_as(&derived) => previous,
            _ => std::sync::Arc::new(derived),
        };
        *self.current.borrow_mut() = Some(results.clone());
        let mut outdated = Vec::new();
        for (i, (_, _, session, _)) in request.scripts.iter().enumerate() {
            let mut session = session.borrow_mut();
            let attached = session.script().table_parameters.as_ref().is_some_and(|r| std::sync::Arc::ptr_eq(r, &results));
            if !attached {
                session.set_table_parameters(Some(results.clone()));
                // An analysis without table parameters reads no results
                if !session.script().table_parameters_current() {
                    outdated.push(i as u32);
                }
            }
        }
        outdated
    }

    /// Give the published table parameters to a session that is no script of the session, e.g. a draft
    pub fn attach(&self, session: &ScriptSession) -> bool {
        let Some(results) = self.current.borrow().clone() else { return false };
        let mut session = session.inner.borrow_mut();
        if session.script().table_parameters.as_ref().is_some_and(|r| std::sync::Arc::ptr_eq(r, &results)) {
            return false;
        }
        session.set_table_parameters(Some(results));
        !session.script().table_parameters_current()
    }
}

impl Default for TableParameters {
    fn default() -> Self {
        Self::new()
    }
}

/// Quote an identifier if it would not read back unquoted, e.g. the name of a script reference `:"foo-2"`
#[wasm_bindgen(js_name = quoteIdentifier)]
pub fn quote_identifier(text: &str) -> String {
    dashql_core::utils::quote_identifier(text)
}

/// Quote a column name for a column reference in SQL text, also quotes keywords that are not unreserved, e.g. `"user"`
#[wasm_bindgen(js_name = quoteColumnName)]
pub fn quote_column_name(text: &str) -> String {
    dashql_core::utils::quote_column_name(text)
}

/// The relations that the statements of a text create or drop, returns packed `TouchedRelations`
#[wasm_bindgen(js_name = touchedRelations)]
pub fn touched_relations(text: &str) -> Vec<u8> {
    finish!(dashql_core_session::touched_relations::touched_relations(text))
}

/// Process a batch request into a `BatchResult`
#[wasm_bindgen(js_name = processBatch)]
pub fn process_batch(request: &[u8]) -> Result<Vec<u8>, JsError> {
    dashql_core_session::batch::process_batch(request).map_err(js_error)
}


/// A query profile (`dashql_query_profile_*`)
#[wasm_bindgen]
pub struct QueryProfile {
    /// The core query profile
    inner: dashql_core_profile::QueryProfile,
}

#[wasm_bindgen]
impl QueryProfile {
    #[wasm_bindgen(constructor)]
    pub fn new() -> QueryProfile {
        QueryProfile {
            inner: dashql_core_profile::QueryProfile::new(),
        }
    }

    /// Configure the layout with a packed `ProfileLayoutConfig`
    #[allow(clippy::too_many_arguments)]
    pub fn configure(
        &mut self,
        level_height: f64,
        node_height: f64,
        node_margin_horizontal: f64,
        node_padding_left: f64,
        node_padding_right: f64,
        icon_width: f64,
        icon_margin_right: f64,
        max_label_chars: u32,
        width_per_label_char: f64,
        node_min_width: f64,
        node_margin_vertical: f64,
        orientation: u8,
        symbol_width: f64,
    ) {
        let config = dashql_buffers::profile::ProfileLayoutConfig::new(
            level_height,
            node_height,
            node_margin_horizontal,
            node_padding_left,
            node_padding_right,
            icon_width,
            icon_margin_right,
            max_label_chars,
            width_per_label_char,
            node_min_width,
            node_margin_vertical,
            dashql_buffers::profile::ProfileLayoutOrientation(orientation),
            symbol_width,
        );
        self.inner.configure(&config);
    }

    /// Lay out the loaded plan again with the configured layout, e.g. after configuring the other orientation
    #[wasm_bindgen(js_name = computeLayout)]
    pub fn compute_layout(&mut self) {
        self.inner.compute_layout();
    }

    /// Load a Hyper plan and compute the layout, throws if the plan cannot be parsed
    #[wasm_bindgen(js_name = loadHyperPlan)]
    pub fn load_hyper_plan(&mut self, plan: &[u8]) -> Result<(), JsError> {
        self.inner.parse_hyper_plan(plan).map_err(|status| js_error(Error::status(status)))?;
        self.inner.compute_layout();
        Ok(())
    }

    /// Load a Trino plan (EXPLAIN JSON fragments or a QueryInfo with stage plans) and compute the layout, throws
    /// if the plan cannot be parsed. Resets the execution state.
    #[wasm_bindgen(js_name = loadTrinoPlan)]
    pub fn load_trino_plan(&mut self, plan: &[u8]) -> Result<(), JsError> {
        self.inner.parse_trino_plan(plan).map_err(|status| js_error(Error::status(status)))?;
        self.inner.compute_layout();
        Ok(())
    }

    pub fn reset(&mut self) {
        self.inner.reset();
    }

    /// Reset the execution state, drops the structure that was registered at runtime
    #[wasm_bindgen(js_name = resetExecution)]
    pub fn reset_execution(&mut self) {
        self.inner.reset_execution();
    }

    /// The structure version, the structure must be repacked when it changes
    #[wasm_bindgen(js_name = structureVersion)]
    pub fn structure_version(&self) -> u32 {
        self.inner.structure_version()
    }

    /// Apply input events (a JSON array), returns the packed `QueryProfileEvents` of the effective state changes
    #[wasm_bindgen(js_name = applyEvents)]
    pub fn apply_events(&mut self, events: &[u8]) -> Result<Vec<u8>, JsError> {
        let updates = self.inner.apply_events_json(events).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(self.inner.pack_events(&updates))
    }

    /// Start an empty model for a query of an engine (`ProfileEngine`), the structure appears with the progress
    #[wasm_bindgen(js_name = startQuery)]
    pub fn start_query(&mut self, engine: u8) {
        self.inner.start_query(dashql_buffers::profile::ProfileEngine(engine));
    }

    /// Apply the `stats` of a Trino `/v1/statement` response (JSON) received at a time in milliseconds since
    /// epoch, returns the packed `QueryProfileEvents` of the effective state changes
    #[wasm_bindgen(js_name = applyTrinoStatementStats)]
    pub fn apply_trino_statement_stats(&mut self, stats: &[u8], time: f64) -> Result<Vec<u8>, JsError> {
        let updates = self
            .inner
            .apply_trino_statement_stats(stats, time.max(0.0) as u64)
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(self.inner.pack_events(&updates))
    }

    /// Apply a Trino QueryInfo (JSON, pruned or not) received at a time in milliseconds since epoch: the pipelines
    /// and slot statistics of the stages. Returns the packed `QueryProfileEvents` of the effective state changes.
    #[wasm_bindgen(js_name = applyTrinoQueryInfo)]
    pub fn apply_trino_query_info(&mut self, info: &[u8], time: f64) -> Result<Vec<u8>, JsError> {
        let updates = self
            .inner
            .apply_trino_query_info(info, time.max(0.0) as u64)
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(self.inner.pack_events(&updates))
    }

    /// The current execution state as packed `QueryProfileEvents`, one update per entity with state
    #[wasm_bindgen(js_name = snapshotEvents)]
    pub fn snapshot_events(&self) -> Vec<u8> {
        self.inner.pack_events(&self.inner.snapshot_events())
    }

    /// The packed `QueryProfile`
    pub fn pack(&self) -> Vec<u8> {
        self.inner.pack_buffer()
    }
}

impl Default for QueryProfile {
    fn default() -> Self {
        Self::new()
    }
}
