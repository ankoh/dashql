#include "dashql/analyzer/completion.h"

#include <flatbuffers/buffer.h>

#include <variant>

#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/catalog_object.h"
#include "dashql/parser/grammar/keywords.h"
#include "dashql/parser/parser.h"
#include "dashql/script.h"
#include "dashql/script_registry.h"
#include "dashql/text/names.h"
#include "dashql/utils/string_conversion.h"
#include "dashql/utils/string_trimming.h"

namespace dashql {

namespace {

// Keyword prevalence modifiers
// Users write some keywords much more likely than others, and we hardcode some prevalence scores.
// Example: "se" should suggest "select" before "set"
static constexpr Completion::ScoreValueType KEYWORD_VERY_POPULAR = 3;
static constexpr Completion::ScoreValueType KEYWORD_POPULAR = 2;
static constexpr Completion::ScoreValueType KEYWORD_DEFAULT = 0;

// Coarse base score of a registered name
static constexpr Completion::ScoreValueType NAME_TAG_IGNORE = 0;
static constexpr Completion::ScoreValueType NAME_TAG_UNLIKELY = 10;
static constexpr Completion::ScoreValueType NAME_TAG_LIKELY = 20;

// Fine-granular score modifiers
static constexpr Completion::ScoreValueType SUBSTRING_SCORE_MODIFIER = 30;         // User typed name substring
static constexpr Completion::ScoreValueType PREFIX_SCORE_MODIFIER = 5;             // User typed name prefix
static constexpr Completion::ScoreValueType RESOLVING_TABLE_SCORE_MODIFIER = 5;    // Table is resolving unresolved
static constexpr Completion::ScoreValueType UNRESOLVED_PEER_SCORE_MODIFIER = 1;    // Share unresolved table
static constexpr Completion::ScoreValueType DOT_SCHEMA_SCORE_MODIFIER = 2;         // Dot completion for schema
static constexpr Completion::ScoreValueType DOT_TABLE_SCORE_MODIFIER = 2;          // Dot completion for table
static constexpr Completion::ScoreValueType DOT_COLUMN_SCORE_MODIFIER = 2;         // Dot completion for column
static constexpr Completion::ScoreValueType IN_NAME_SCOPE_SCORE_MODIFIER = 10;     // Candidate is in scope
static constexpr Completion::ScoreValueType IN_SAME_STATEMENT_SCORE_MODIFIER = 1;  // Candidate used in same statement
static constexpr Completion::ScoreValueType IN_SAME_SCRIPT_SCORE_MODIFIER = 1;     // Candidate used in same script
static constexpr Completion::ScoreValueType IN_OTHER_SCRIPT_SCORE_MODIFIER = 1;    // Candidate used in other script

// Design choices for the score modifiers
static_assert((NAME_TAG_UNLIKELY + SUBSTRING_SCORE_MODIFIER) > NAME_TAG_LIKELY,
              "An unlikely name that is a substring outweighs a likely name");
static_assert(IN_NAME_SCOPE_SCORE_MODIFIER > PREFIX_SCORE_MODIFIER,
              "Candidates being available in scope weighs more than being a prefix");
static_assert(SUBSTRING_SCORE_MODIFIER >
                  (IN_SAME_STATEMENT_SCORE_MODIFIER + IN_SAME_SCRIPT_SCORE_MODIFIER + IN_OTHER_SCRIPT_SCORE_MODIFIER),
              "Candidates that are used elsewhere are not higher scoring than a substring match");
static_assert(IN_NAME_SCOPE_SCORE_MODIFIER >
                  (IN_SAME_STATEMENT_SCORE_MODIFIER + IN_SAME_SCRIPT_SCORE_MODIFIER + IN_OTHER_SCRIPT_SCORE_MODIFIER),
              "Being in scope outweighs being referenced elsewhere");
static_assert(RESOLVING_TABLE_SCORE_MODIFIER >
                  (IN_SAME_STATEMENT_SCORE_MODIFIER + IN_SAME_SCRIPT_SCORE_MODIFIER + IN_OTHER_SCRIPT_SCORE_MODIFIER),
              "Resolving unresolved columns outweighs being referenced elsewhere");

Completion::ScoreValueType computeCandidateScore(Completion::CandidateTags tags) {
    Completion::ScoreValueType score = 0;
    score += ((tags & buffers::completion::CandidateTag::KEYWORD_DEFAULT) != 0) * KEYWORD_DEFAULT;
    score += ((tags & buffers::completion::CandidateTag::KEYWORD_POPULAR) != 0) * KEYWORD_POPULAR;
    score += ((tags & buffers::completion::CandidateTag::KEYWORD_VERY_POPULAR) != 0) * KEYWORD_VERY_POPULAR;

    score += ((tags & buffers::completion::CandidateTag::SUBSTRING_MATCH) != 0) * SUBSTRING_SCORE_MODIFIER;
    score += ((tags & buffers::completion::CandidateTag::PREFIX_MATCH) != 0) * PREFIX_SCORE_MODIFIER;
    score += ((tags & buffers::completion::CandidateTag::RESOLVING_TABLE) != 0) * RESOLVING_TABLE_SCORE_MODIFIER;
    score += ((tags & buffers::completion::CandidateTag::UNRESOLVED_PEER) != 0) * UNRESOLVED_PEER_SCORE_MODIFIER;

    score += ((tags & buffers::completion::CandidateTag::DOT_RESOLUTION_TABLE) != 0) * DOT_TABLE_SCORE_MODIFIER;
    score += ((tags & buffers::completion::CandidateTag::DOT_RESOLUTION_SCHEMA) != 0) * DOT_SCHEMA_SCORE_MODIFIER;
    score += ((tags & buffers::completion::CandidateTag::DOT_RESOLUTION_COLUMN) != 0) * DOT_COLUMN_SCORE_MODIFIER;

    score += ((tags & buffers::completion::CandidateTag::IN_NAME_SCOPE) != 0) * IN_NAME_SCOPE_SCORE_MODIFIER;
    score += ((tags & buffers::completion::CandidateTag::IN_SAME_STATEMENT) != 0) * IN_SAME_STATEMENT_SCORE_MODIFIER;
    score += ((tags & buffers::completion::CandidateTag::IN_SAME_SCRIPT) != 0) * IN_SAME_SCRIPT_SCORE_MODIFIER;
    score += ((tags & buffers::completion::CandidateTag::IN_OTHER_SCRIPT) != 0) * IN_OTHER_SCRIPT_SCORE_MODIFIER;
    return score;
}

using NameScoringTable = std::array<std::pair<buffers::analyzer::NameTag, Completion::ScoreValueType>, 8>;

static constexpr NameScoringTable NAME_SCORE_DEFAULTS{{
    {buffers::analyzer::NameTag::NONE, NAME_TAG_IGNORE},
    {buffers::analyzer::NameTag::SCHEMA_NAME, NAME_TAG_LIKELY},
    {buffers::analyzer::NameTag::DATABASE_NAME, NAME_TAG_LIKELY},
    {buffers::analyzer::NameTag::TABLE_NAME, NAME_TAG_LIKELY},
    {buffers::analyzer::NameTag::TABLE_ALIAS, NAME_TAG_LIKELY},
    {buffers::analyzer::NameTag::COLUMN_NAME, NAME_TAG_LIKELY},
}};

static constexpr NameScoringTable NAME_SCORE_TABLE_REF{{
    {buffers::analyzer::NameTag::NONE, NAME_TAG_IGNORE},
    {buffers::analyzer::NameTag::SCHEMA_NAME, NAME_TAG_LIKELY},
    {buffers::analyzer::NameTag::DATABASE_NAME, NAME_TAG_LIKELY},
    {buffers::analyzer::NameTag::TABLE_NAME, NAME_TAG_LIKELY},
    {buffers::analyzer::NameTag::TABLE_ALIAS, NAME_TAG_UNLIKELY},
    {buffers::analyzer::NameTag::COLUMN_NAME, NAME_TAG_UNLIKELY},
}};

static constexpr NameScoringTable NAME_SCORE_COLUMN_REF{{
    {buffers::analyzer::NameTag::NONE, NAME_TAG_IGNORE},
    {buffers::analyzer::NameTag::SCHEMA_NAME, NAME_TAG_UNLIKELY},
    {buffers::analyzer::NameTag::DATABASE_NAME, NAME_TAG_UNLIKELY},
    {buffers::analyzer::NameTag::TABLE_NAME, NAME_TAG_UNLIKELY},
    {buffers::analyzer::NameTag::TABLE_ALIAS, NAME_TAG_LIKELY},
    {buffers::analyzer::NameTag::COLUMN_NAME, NAME_TAG_LIKELY},
}};

/// We use a prevalence score to rank keywords by popularity.
/// It is much more likely that a user wants to complete certain keywords than others.
/// The added score is chosen so small that it only influences the ranking among similarly ranked keywords.
/// (i.e., being prefix, substring or in-scope outweighs the prevalence score)
static constexpr buffers::completion::CandidateTag GetKeywordPrevalence(parser::Parser::symbol_kind_type keyword) {
    switch (keyword) {
        case parser::Parser::symbol_kind_type::S_AND:
        case parser::Parser::symbol_kind_type::S_FROM:
        case parser::Parser::symbol_kind_type::S_GROUP_P:
        case parser::Parser::symbol_kind_type::S_ORDER:
        case parser::Parser::symbol_kind_type::S_SELECT:
        case parser::Parser::symbol_kind_type::S_WHERE:
            return buffers::completion::CandidateTag::KEYWORD_VERY_POPULAR;
        case parser::Parser::symbol_kind_type::S_AS:
        case parser::Parser::symbol_kind_type::S_ASC_P:
        case parser::Parser::symbol_kind_type::S_BY:
        case parser::Parser::symbol_kind_type::S_CASE:
        case parser::Parser::symbol_kind_type::S_CAST:
        case parser::Parser::symbol_kind_type::S_DESC_P:
        case parser::Parser::symbol_kind_type::S_END_P:
        case parser::Parser::symbol_kind_type::S_LIKE:
        case parser::Parser::symbol_kind_type::S_LIMIT:
        case parser::Parser::symbol_kind_type::S_OFFSET:
        case parser::Parser::symbol_kind_type::S_OR:
        case parser::Parser::symbol_kind_type::S_SET:
        case parser::Parser::symbol_kind_type::S_THEN:
        case parser::Parser::symbol_kind_type::S_WHEN:
        case parser::Parser::symbol_kind_type::S_WITH:
            return buffers::completion::CandidateTag::KEYWORD_POPULAR;
        case parser::Parser::symbol_kind_type::S_BETWEEN:
        case parser::Parser::symbol_kind_type::S_DAY_P:
        case parser::Parser::symbol_kind_type::S_PARTITION:
        case parser::Parser::symbol_kind_type::S_SETOF:
        default:
            return buffers::completion::CandidateTag::KEYWORD_DEFAULT;
    }
}

bool doNotCompleteSymbol(parser::Parser::symbol_type& sym) {
    switch (sym.kind_) {
        case parser::Parser::symbol_kind_type::S_COMMA:
        case parser::Parser::symbol_kind_type::S_LRB:
        case parser::Parser::symbol_kind_type::S_RRB:
        case parser::Parser::symbol_kind_type::S_LSB:
        case parser::Parser::symbol_kind_type::S_RSB:
        case parser::Parser::symbol_kind_type::S_SEMICOLON:
        case parser::Parser::symbol_kind_type::S_COLON:
        case parser::Parser::symbol_kind_type::S_PLUS:
        case parser::Parser::symbol_kind_type::S_MINUS:
        case parser::Parser::symbol_kind_type::S_STAR:
        case parser::Parser::symbol_kind_type::S_DIVIDE:
        case parser::Parser::symbol_kind_type::S_MODULO:
        case parser::Parser::symbol_kind_type::S_QUESTION_MARK:
        case parser::Parser::symbol_kind_type::S_CIRCUMFLEX:
        case parser::Parser::symbol_kind_type::S_LESS_THAN:
        case parser::Parser::symbol_kind_type::S_GREATER_THAN:
        case parser::Parser::symbol_kind_type::S_EQUALS:
            return true;
        default:
            return false;
    }
}

}  // namespace

std::span<std::string_view> Completion::GetQualifiedTableName(const CatalogEntry::QualifiedTableName& name) {
    std::vector<std::string_view> names;
    names.reserve(3);
    if (!name.database_name.get().text.empty()) {
        names.push_back(name.database_name.get().text);
        names.push_back(name.schema_name.get().text);
        names.push_back(name.table_name.get().text);
    } else if (!name.schema_name.get().text.empty()) {
        names.push_back(name.schema_name.get().text);
        names.push_back(name.table_name.get().text);
    } else if (!name.table_name.get().text.empty()) {
        names.push_back(name.table_name.get().text);
    }
    return top_candidate_names.PushBack(std::move(names));
}

std::span<std::string_view> Completion::GetQualifiedColumnName(const CatalogEntry::QualifiedTableName& name,
                                                               const RegisteredName& column) {
    std::vector<std::string_view> names;
    names.reserve(4);
    if (!name.database_name.get().text.empty()) {
        names.push_back(name.database_name.get().text);
        names.push_back(name.schema_name.get().text);
        names.push_back(name.table_name.get().text);
    } else if (!name.schema_name.get().text.empty()) {
        names.push_back(name.schema_name.get().text);
        names.push_back(name.table_name.get().text);
    } else if (!name.table_name.get().text.empty()) {
        names.push_back(name.table_name.get().text);
    }
    names.push_back(column.text);
    return top_candidate_names.PushBack(std::move(names));
}

std::span<std::string_view> Completion::GetQualifiedColumnName(const RegisteredName& alias,
                                                               const RegisteredName& column) {
    std::vector<std::string_view> names;
    names.reserve(2);
    names.push_back(alias.text);
    names.push_back(column.text);
    return top_candidate_names.PushBack(std::move(names));
}

std::vector<Completion::NameComponent> Completion::ReadCursorNamePath(sx::parser::Location& name_path_loc) const {
    auto& nodes = cursor.script.parsed_script->nodes;

    std::optional<uint32_t> name_ast_node_id = std::visit(
        [&](const auto& ctx) -> std::optional<uint32_t> {
            using T = std::decay_t<decltype(ctx)>;
            if constexpr (std::is_same_v<T, ScriptCursor::TableRefContext>) {
                auto& tableref = cursor.script.analyzed_script->table_references[ctx.table_reference_id];
                assert(std::holds_alternative<AnalyzedScript::TableReference::RelationExpression>(tableref.inner));
                return std::get<AnalyzedScript::TableReference::RelationExpression>(tableref.inner)
                    .table_name.ast_node_id;
            } else if constexpr (std::is_same_v<T, ScriptCursor::ColumnRefContext>) {
                auto& expr = cursor.script.analyzed_script->expressions[ctx.expression_id];
                assert(std::holds_alternative<AnalyzedScript::Expression::ColumnRef>(expr.inner));
                return std::get<AnalyzedScript::Expression::ColumnRef>(expr.inner).column_name.ast_node_id;
            } else {
                return std::nullopt;
            }
        },
        cursor.context);

    // Couldn't find an ast name path?
    if (!name_ast_node_id.has_value()) {
        return {};
    }
    // Is not an array?
    auto& node = nodes[*name_ast_node_id];
    if (node.node_type() != buffers::parser::NodeType::ARRAY) {
        return {};
    }
    name_path_loc = node.location();

    // Get the child nodes
    auto children =
        std::span<buffers::parser::Node>{nodes}.subspan(node.children_begin_or_value(), node.children_count());

    // Collect the name path
    std::vector<NameComponent> components;
    for (size_t i = 0; i != children.size(); ++i) {
        // A child is either a name, an index or a *.
        auto& child = children[i];
        switch (child.node_type()) {
            case buffers::parser::NodeType::NAME: {
                auto& name = cursor.script.scanned_script->GetNames().At(child.children_begin_or_value());
                components.push_back(NameComponent{
                    .loc = child.location(),
                    .type = NameComponentType::Name,
                    .name = name,
                });
                break;
            }
            case buffers::parser::NodeType::OBJECT_SQL_INDIRECTION_STAR:
                components.push_back(NameComponent{
                    .loc = child.location(),
                    .type = NameComponentType::Star,
                    .name = std::nullopt,
                });
                break;
            case buffers::parser::NodeType::OBJECT_SQL_INDIRECTION_INDEX:
                components.push_back(NameComponent{
                    .loc = child.location(),
                    .type = NameComponentType::Index,
                    .name = std::nullopt,
                });
                break;
            case buffers::parser::NodeType::OBJECT_EXT_TRAILING_DOT:
                components.push_back(NameComponent{
                    .loc = child.location(),
                    .type = NameComponentType::TrailingDot,
                    .name = std::nullopt,
                });
                return components;
            default:
                // XXX Bail out
                return {};
        }
    }
    return components;
}

void Completion::FindCandidatesForNamePath() {
    // The cursor location
    auto cursor_location = cursor.scanner_location->text_offset;
    // Read the name path
    sx::parser::Location name_path_loc;
    auto name_path_buffer = ReadCursorNamePath(name_path_loc);
    std::span<Completion::NameComponent> name_path = name_path_buffer;

    // Filter all name components in the path.
    // A name path could also contain an index indirection or a star.
    // We're only interested in the names here.
    // If the user completes a name with index or star, we'll just truncate everything.
    size_t name_count = 0;
    // Additionally find the sealed prefix.
    // If we're completing after a dot, the word before the dot is not meant to be completed.
    size_t sealed = 0;

    // Last text prefix
    std::string_view last_text_prefix;
    uint32_t truncate_at = name_path_loc.offset() + name_path_loc.length();
    for (; name_count < name_path.size(); ++name_count) {
        if (name_path[name_count].type == NameComponentType::TrailingDot) {
            truncate_at = name_path[name_count].loc.offset() + 1;
            break;
        }
        if (name_path[name_count].type != NameComponentType::Name) {
            truncate_at = name_path[name_count].loc.offset();
            break;
        }
        if ((name_path[name_count].loc.offset() + name_path[name_count].loc.length()) < cursor_location) {
            ++sealed;
        } else {
            // The cursor points into a name?

            // Determine the substring left of the cursor.
            // The user may write:
            //  foo.bar.something
            //              ^ if the cursor points to t, we'll complete "some"
            //
            auto last_loc = name_path[name_count].loc;
            auto last_text = cursor.script.scanned_script->ReadTextAtLocation(last_loc);
            auto last_content =
                std::find_if(last_text.begin(), last_text.end(), is_no_double_quote) - last_text.begin();
            auto last_content_ofs = last_loc.offset() + last_content;
            auto last_prefix_length = std::max<size_t>(cursor_location, last_content_ofs) - last_content_ofs;
            last_text_prefix = last_text.substr(last_content, last_prefix_length);

            // Truncate when replacing
            truncate_at = last_loc.offset();
            break;
        }
    }
    name_path = name_path.subspan(0, name_count);

    // Determine text to replace
    sx::parser::Location replace_text_at{
        truncate_at, std::max<uint32_t>(name_path_loc.offset() + name_path_loc.length(), truncate_at) - truncate_at};

    // Is the path empty?
    // Nothing to complete then.
    if (name_path.size() == 0) {
        return;
    }

    /// A dot candidate
    struct DotCandidate {
        std::string_view name;
        CandidateTags candidate_tags;
        NameTags name_tags;
        QualifiedCatalogObjectID object_id;
        const CatalogObject& object;
    };
    // Collect all candidate strings
    std::vector<DotCandidate> dot_candidates;

    // Are we completing a table ref?
    if (auto* ctx = std::get_if<ScriptCursor::TableRefContext>(&cursor.context)) {
        auto& script = cursor.script;
        auto& catalog = cursor.script.catalog;

        switch (sealed) {
            case 0:
                break;
            case 1: {
                // User gave us a._
                // "a" might be a database name or a schema name

                // Is referring to a schema in the default database?
                std::string_view a_text = name_path[0].name.value().get();
                std::vector<std::pair<std::reference_wrapper<const CatalogEntry::TableDeclaration>, bool>> tables;
                script.analyzed_script->ResolveSchemaTablesWithCatalog(a_text, tables);
                if (!tables.empty()) {
                    // Add the tables as candidates
                    for (auto& [table, through_catalog] : tables) {
                        // XXX Also discover tables with different schemas
                        //     We can rank entries higher that are in the default database

                        // Store the candidate
                        auto& name = table.get().table_name.table_name.get();
                        DotCandidate candidate{
                            .name = name.text,
                            .candidate_tags = {buffers::completion::CandidateTag::DOT_RESOLUTION_TABLE},
                            .name_tags = {buffers::analyzer::NameTag::TABLE_NAME},
                            .object_id = table.get().object_id,
                            .object = table.get().CastToBase()};
                        candidate.candidate_tags.AddIf(buffers::completion::CandidateTag::THROUGH_CATALOG,
                                                       through_catalog);
                        dot_candidates.push_back(std::move(candidate));
                    }
                }

                // Is referring to a database?
                std::vector<std::pair<std::reference_wrapper<const CatalogEntry::SchemaReference>, bool>> schemas;
                script.analyzed_script->ResolveDatabaseSchemasWithCatalog(a_text, schemas);
                if (!schemas.empty()) {
                    // Add the schemas name as candidates
                    for (auto& [schema, through_catalog] : schemas) {
                        // Store the candidate
                        auto& name = schema.get().schema_name;
                        DotCandidate candidate{
                            .name = name,
                            .candidate_tags = {buffers::completion::CandidateTag::DOT_RESOLUTION_SCHEMA},
                            .name_tags = NameTags{buffers::analyzer::NameTag::SCHEMA_NAME},
                            .object_id = schema.get().object_id,
                            .object = schema.get().CastToBase()};
                        candidate.candidate_tags.AddIf(buffers::completion::CandidateTag::THROUGH_CATALOG,
                                                       through_catalog);
                        dot_candidates.push_back(std::move(candidate));
                    }
                }
                break;
            }
            case 2: {
                // User gave us a.b._
                // "a" must be a database name, "b" must be a schema name.
                std::string_view a_text = name_path[0].name.value().get();
                std::string_view b_text = name_path[1].name.value().get();

                // Is a known?
                std::vector<std::pair<std::reference_wrapper<const CatalogEntry::TableDeclaration>, bool>> tables;
                script.analyzed_script->ResolveSchemaTablesWithCatalog(a_text, b_text, tables);
                if (!tables.empty()) {
                    // Add the tables as candidates
                    for (auto& [table, through_catalog] : tables) {
                        auto& name = table.get().table_name.table_name.get();
                        DotCandidate candidate{
                            .name = name,
                            .candidate_tags = {buffers::completion::CandidateTag::DOT_RESOLUTION_TABLE},
                            .name_tags = NameTags{buffers::analyzer::NameTag::TABLE_NAME},
                            .object_id = table.get().object_id,
                            .object = {table.get().CastToBase()}};
                        candidate.candidate_tags.AddIf(buffers::completion::CandidateTag::THROUGH_CATALOG,
                                                       through_catalog);
                        dot_candidates.push_back(std::move(candidate));
                    }
                }
                break;
            }
            case 3:
                // User gave us a.b.c._ ?
                // Don't resolve any candidates, not supported.
                break;
        }
    }

    // Are we completing a column ref?
    else if (auto* ctx = std::get_if<ScriptCursor::ColumnRefContext>(&cursor.context)) {
        auto& script = cursor.script;
        switch (sealed) {
            case 0:
                break;
            case 1: {
                // User gave us a._
                // "a" might be a table alias
                std::string_view a_text = name_path[0].name.value().get();

                // Check all naming scopes for tables that are in scope.
                for (auto& name_scope : cursor.name_scopes) {
                    // Does the name refer to a resolved named table in the scope?
                    // This means we're dot-completing a known table alias from here on.
                    auto table_iter = name_scope.get().referenced_tables_by_name.find(a_text);
                    if (table_iter != name_scope.get().referenced_tables_by_name.end()) {
                        // Found a table declaration with that alias
                        auto& table_decl = table_iter->second.get();
                        // Register all column names as alias
                        for (auto& column : table_decl.table_columns) {
                            auto& name = column.column_name.get();
                            DotCandidate candidate{
                                .name = name,
                                .candidate_tags = {buffers::completion::CandidateTag::DOT_RESOLUTION_COLUMN},
                                .name_tags = NameTags{buffers::analyzer::NameTag::COLUMN_NAME},
                                .object_id = column.object_id,
                                .object = {column.CastToBase()}};
                            candidate.candidate_tags.AddIf(
                                buffers::completion::CandidateTag::THROUGH_CATALOG,
                                table_decl.GetTableID().GetOrigin() != script.GetCatalogEntryId());
                            dot_candidates.push_back(std::move(candidate));
                        }
                        break;
                    }
                }
                break;
            }
        }
    }

    for (auto& dot_candidate : dot_candidates) {
        // Did we already add the dot candidate?
        if (auto iter = candidate_objects_by_id.find(dot_candidate.object_id); iter != candidate_objects_by_id.end()) {
            // Update candidate tags and replacement target
            auto& candidate_object = iter->second.get();
            candidate_object.candidate_tags |= dot_candidate.candidate_tags;
            candidate_object.candidate.target_location = replace_text_at;
            candidate_object.candidate.target_location_qualified = name_path_loc;
            assert(candidate_object.candidate.completion_text == dot_candidate.name);

        } else {
            // If the user gave us a text, determine the substring match
            if (!last_text_prefix.empty()) {
                // Check if we have a prefix
                fuzzy_ci_string_view ci_name{dot_candidate.name.data(), dot_candidate.name.size()};
                if (auto pos = ci_name.find(fuzzy_ci_string_view{last_text_prefix.data(), last_text_prefix.size()});
                    pos != fuzzy_ci_string_view::npos) {
                    dot_candidate.candidate_tags |= buffers::completion::CandidateTag::SUBSTRING_MATCH;
                    if (pos == 0) {
                        dot_candidate.candidate_tags |= buffers::completion::CandidateTag::PREFIX_MATCH;
                    }
                }
            }
            // No, do we know the candidate name already?
            if (auto iter = candidates_by_name.find(dot_candidate.name); iter != candidates_by_name.end()) {
                // Name is there, just not the object
                auto& existing = iter->second.get();
                // Fix text replacement
                existing.target_location = replace_text_at;
                existing.target_location_qualified = name_path_loc;
                // Allocate the candidate object
                auto& co = candidate_objects.PushBack(CandidateCatalogObject{
                    .candidate = existing,
                    .candidate_tags = dot_candidate.candidate_tags,
                    .catalog_object_id = dot_candidate.object_id,
                    .catalog_object = dot_candidate.object,
                });
                existing.catalog_objects.PushBack(co);
                existing.candidate_tags |= dot_candidate.candidate_tags;

                assert(!candidate_objects_by_id.contains(dot_candidate.object_id));
                candidate_objects_by_id.insert({dot_candidate.object_id, co});

            } else {
                // Allocate the candidate
                auto& c = candidates.PushBack(Candidate{
                    .completion_text = dot_candidate.name,
                    .coarse_name_tags = dot_candidate.name_tags,
                    .candidate_tags = dot_candidate.candidate_tags,
                    .target_location = replace_text_at,
                    .target_location_qualified = name_path_loc,
                    .catalog_objects = {},
                });
                candidates_by_name.insert({c.completion_text, c});

                // Allocate the candidate object
                auto& co = candidate_objects.PushBack(CandidateCatalogObject{
                    .candidate = c,
                    .candidate_tags = dot_candidate.candidate_tags,
                    .catalog_object_id = dot_candidate.object_id,
                    .catalog_object = dot_candidate.object,
                });
                c.catalog_objects.PushBack(co);

                assert(!candidate_objects_by_id.contains(dot_candidate.object_id));
                candidate_objects_by_id.insert({dot_candidate.object_id, co});
            }
        }
    }
}

void Completion::AddExpectedKeywordsAsCandidates(std::span<parser::Parser::ExpectedSymbol> symbols) {
    auto& location = cursor.scanner_location;

    // Helper to determine the score of a cursor symbol
    auto get_score = [&](const ScannedScript::LocationInfo& loc, parser::Parser::ExpectedSymbol expected,
                         std::string_view keyword_text) -> CandidateTags {
        fuzzy_ci_string_view ci_keyword_text{keyword_text.data(), keyword_text.size()};
        using Relative = ScannedScript::LocationInfo::RelativePosition;

        CandidateTags tags = buffers::completion::CandidateTag::EXPECTED_PARSER_SYMBOL;
        tags |= GetKeywordPrevalence(expected);

        switch (location->relative_pos) {
            case Relative::NEW_SYMBOL_AFTER:
            case Relative::NEW_SYMBOL_BEFORE:
                return tags;
            case Relative::BEGIN_OF_SYMBOL:
            case Relative::MID_OF_SYMBOL:
            case Relative::END_OF_SYMBOL: {
                auto symbol_ofs = location->symbol.location.offset();
                auto symbol_prefix = std::max<uint32_t>(location->text_offset, symbol_ofs) - symbol_ofs;
                fuzzy_ci_string_view ci_symbol_text{cursor.text.data(), symbol_prefix};
                // Is substring?
                if (auto pos = ci_keyword_text.find(ci_symbol_text); pos != fuzzy_ci_string_view::npos) {
                    tags |= buffers::completion::CandidateTag::SUBSTRING_MATCH;
                    if (pos == 0) {
                        tags |= buffers::completion::CandidateTag::PREFIX_MATCH;
                    }
                }
                return tags;
            }
        }
    };

    // Add all expected symbols to the result heap
    for (auto& expected : symbols) {
        auto name = parser::Keyword::GetKeywordName(expected);
        if (!name.empty()) {
            auto tags = get_score(*location, expected, name);
            Candidate candidate{
                .completion_text = name,
                .coarse_name_tags = {},
                .candidate_tags = tags,
                .target_location = location->symbol.location,
                .target_location_qualified = location->symbol.location,
                .score = computeCandidateScore(tags),
            };
            candidate_heap.Insert(std::move(candidate));
        }
    }
}

void Completion::findCandidatesInIndex(const CatalogEntry::NameSearchIndex& index, bool through_catalog) {
    using Relative = ScannedScript::LocationInfo::RelativePosition;

    // Get the current cursor prefix
    auto& location = cursor.scanner_location;
    auto symbol_ofs = location->symbol.location.offset();
    auto symbol_prefix = std::max<uint32_t>(location->text_offset, symbol_ofs) - symbol_ofs;
    std::string_view prefix_text{cursor.text.data(), symbol_prefix};
    fuzzy_ci_string_view ci_prefix_text{cursor.text.data(), symbol_prefix};

    // Fall back to the full word if the cursor prefix is empty
    auto search_text = ci_prefix_text;
    if (search_text.empty()) {
        search_text = {cursor.text.data(), cursor.text.size()};
    }

    // Find all suffixes for the cursor prefix
    for (auto iter = index.lower_bound(search_text); iter != index.end() && iter->first.starts_with(search_text);
         ++iter) {
        auto& name_info = iter->second.get();
        // Check if it's the cursor symbol
        if (!through_catalog && name_info.occurrences == 1 && location->text_offset >= name_info.location.offset() &&
            location->text_offset <= (name_info.location.offset() + name_info.location.length())) {
            continue;
        }
        // Determine the candidate tags
        Completion::CandidateTags candidate_tags{buffers::completion::CandidateTag::NAME_INDEX};
        // Added through catalog?
        candidate_tags.AddIf(buffers::completion::CandidateTag::THROUGH_CATALOG, through_catalog);
        // Is a prefix?
        switch (location->relative_pos) {
            case Relative::BEGIN_OF_SYMBOL:
            case Relative::MID_OF_SYMBOL:
            case Relative::END_OF_SYMBOL:
                candidate_tags |= buffers::completion::CandidateTag::SUBSTRING_MATCH;
                if (fuzzy_ci_string_view{name_info.text.data(), name_info.text.size()}.starts_with(ci_prefix_text)) {
                    candidate_tags |= buffers::completion::CandidateTag::PREFIX_MATCH;
                }
                break;
            default:
                break;
        }

        // Do we know the candidate already?
        Candidate* candidate;
        if (auto iter = candidates_by_name.find(name_info.text); iter != candidates_by_name.end()) {
            candidate = &iter->second.get();
            candidate->coarse_name_tags |= name_info.coarse_analyzer_tags;
            candidate->candidate_tags |= candidate_tags;
        } else {
            candidate = &candidates.PushBack(Candidate{
                .completion_text = name_info.text,
                .coarse_name_tags = name_info.coarse_analyzer_tags,
                .candidate_tags = candidate_tags,
                .target_location = location->symbol.location,
                .target_location_qualified = location->symbol.location,
                .catalog_objects = {},
            });
            candidates_by_name.insert({name_info.text, *candidate});
        }

        // Add the resolved objects
        for (auto& o : name_info.resolved_objects) {
            // Already registered?
            if (auto iter = candidate_objects_by_id.find(o.object_id); iter != candidate_objects_by_id.end()) {
                // Note that this assumes that a catalog object can be added to at most a single candidate.
                assert(&iter->second.get().candidate == candidate);
                iter->second.get().candidate_tags |= candidate_tags;
                continue;
            } else {
                // Allocate the catalog object
                auto& co = candidate_objects.PushBack(CandidateCatalogObject{
                    .candidate = *candidate,
                    .candidate_tags = candidate_tags,
                    .catalog_object_id = o.object_id,
                    .catalog_object = o,
                });
                candidate->catalog_objects.PushBack(co);

                assert(!candidate_objects_by_id.contains(o.object_id));
                candidate_objects_by_id.insert({o.object_id, co});
            }
        }
    }
}

void Completion::FindCandidatesInIndexes() {
    if (auto& analyzed = cursor.script.analyzed_script) {
        // Find candidates in name dictionary of main script
        findCandidatesInIndex(analyzed->GetNameSearchIndex(), false);
        // Find candidates in name dictionary of external script
        cursor.script.catalog.IterateRanked([this, &analyzed](auto entry_id, auto& entry, size_t rank) {
            if (&entry != analyzed.get()) {
                findCandidatesInIndex(entry.GetNameSearchIndex(), true);
            }
        });
    }
}

void Completion::PromoteIdentifiersInScope() {
    // We can be a bit more involved here since the number of entities in a scope should be small(ish)

    // Check all naming scopes for tables that are in scope.
    for (auto& name_scope : cursor.name_scopes) {
        auto& scope = name_scope.get();

        // Iterate over all table references in the scope.
        // A column name belonging to a table ref gets boosted.
        for (auto& table_ref : scope.table_references) {
            // Resolved table ref?
            auto* rel_expr = std::get_if<AnalyzedScript::TableReference::RelationExpression>(&table_ref.inner);
            if (!rel_expr || !rel_expr->resolved_table.has_value()) {
                continue;
            }

            // XXX Alternatives

            // Find the table in the catalog
            // Note that this would benefit from storing candidates in a btree::map.
            // Then we could just prefix-search with the table id without ever resolving the table column count.
            auto& resolved_table_entry = rel_expr->resolved_table.value();
            auto resolved_table_id = resolved_table_entry.catalog_table_id.UnpackTableID();
            auto* resolved_table = cursor.script.catalog.ResolveTable(resolved_table_id);
            if (!resolved_table) {
                continue;
            }

            // We can just derive the table column ids based on the column count
            for (uint32_t i = 0; i < resolved_table->table_columns.size(); ++i) {
                auto iter = candidate_objects_by_id.find(QualifiedCatalogObjectID::TableColumn(resolved_table_id, i));
                if (iter == candidate_objects_by_id.end()) {
                    continue;
                }
                // Found column reachable through the scope that is a candidate.
                auto& co = iter->second.get();
                co.candidate_tags |= buffers::completion::CandidateTag::IN_NAME_SCOPE;
                co.candidate.candidate_tags |= buffers::completion::CandidateTag::IN_NAME_SCOPE;
            }
        }

        // Iterate over all existing column references in the scope.
        // A resolved column name that has been used before gets boosted.
        for (auto& expr : scope.expressions) {
            // Resolved column ref?
            auto* colref = std::get_if<AnalyzedScript::Expression::ColumnRef>(&expr.inner);
            if (!colref || !colref->resolved_column.has_value()) {
                continue;
            }

            // Check directly if the the column is stored as candidate
            auto& resolved_column = colref->resolved_column.value();
            auto iter = candidate_objects_by_id.find(resolved_column.catalog_table_column_id);
            if (iter == candidate_objects_by_id.end()) {
                continue;
            }

            // Found column reachable through the scope that is a candidate.
            auto& co = iter->second.get();
            co.candidate_tags |= buffers::completion::CandidateTag::IN_NAME_SCOPE;
            co.candidate.candidate_tags |= buffers::completion::CandidateTag::IN_NAME_SCOPE;
        }
    }
}

void Completion::PromoteIdentifiersInScripts(ScriptRegistry& registry) {
    for (auto& [key, script_entry] : registry.GetRegisteredScripts()) {
        bool is_same_script = &script_entry.script == &cursor.script;
        buffers::completion::CandidateTag candidate_tag = is_same_script
                                                              ? buffers::completion::CandidateTag::IN_SAME_SCRIPT
                                                              : buffers::completion::CandidateTag::IN_OTHER_SCRIPT;

        script_entry.analyzed->expressions.ForEach([&](size_t i, const AnalyzedScript::Expression& expr) {
            // Resolved column ref?
            auto* colref = std::get_if<AnalyzedScript::Expression::ColumnRef>(&expr.inner);
            if (!colref || !colref->resolved_column.has_value()) {
                return;
            }

            // Check directly if the the column is stored as candidate
            auto& resolved_column = colref->resolved_column.value();
            auto iter = candidate_objects_by_id.find(resolved_column.catalog_table_column_id);
            if (iter == candidate_objects_by_id.end()) {
                return;
            }

            // Found a referenced column in the scope that was used before.
            // Boost it.
            auto& co = iter->second.get();
            co.candidate_tags |= candidate_tag;
            co.candidate.candidate_tags |= candidate_tag;
        });
    }
}

void Completion::PromoteTablesAndPeersForUnresolvedColumns() {
    if (!cursor.statement_id.has_value() || !cursor.script.analyzed_script) {
        return;
    }
    auto& analyzed_script = *cursor.script.analyzed_script;
    auto& catalog = cursor.script.catalog;
    std::vector<CatalogEntry::TableColumn> tmp_columns;

    // Iterate all unresolved columns in the current script
    for (auto& name_scope : cursor.name_scopes) {
        auto& scope = name_scope.get();
        for (auto& expr : scope.expressions) {
            // Is unresolved?
            if (auto* column_ref = std::get_if<AnalyzedScript::Expression::ColumnRef>(&expr.inner);
                column_ref && !column_ref->resolved_column.has_value()) {
                auto& column_name = column_ref->column_name.column_name.get();
                tmp_columns.clear();
                // Resolve all table columns that would match the unresolved name?
                cursor.script.analyzed_script->ResolveTableColumnsWithCatalog(column_name, tmp_columns);
                // Register the table name
                for (auto& table_col : tmp_columns) {
                    auto& table = table_col.table->get();
                    auto& table_name = table.table_name.table_name.get();
                    // Boost the table name as candidate (if any)
                    if (auto iter = candidate_objects_by_id.find(table.object_id);
                        iter != candidate_objects_by_id.end()) {
                        auto& co = iter->second.get();
                        co.candidate_tags |= buffers::completion::CandidateTag::RESOLVING_TABLE;
                        co.candidate.candidate_tags |= buffers::completion::CandidateTag::RESOLVING_TABLE;
                    }
                    // Promote column names in these tables
                    for (auto& peer_col : table.table_columns) {
                        // Boost the peer name as candidate (if any)
                        if (auto iter = candidate_objects_by_id.find(peer_col.object_id);
                            iter != candidate_objects_by_id.end()) {
                            auto& co = iter->second.get();
                            co.candidate_tags |= buffers::completion::CandidateTag::UNRESOLVED_PEER;
                            co.candidate.candidate_tags |= buffers::completion::CandidateTag::UNRESOLVED_PEER;
                        }
                    }
                }
            }
        }
    }
}

static const NameScoringTable& selectNameScoringTable(buffers::completion::CompletionStrategy strategy) {
    switch (strategy) {
        case buffers::completion::CompletionStrategy::DEFAULT:
            return NAME_SCORE_DEFAULTS;
        case buffers::completion::CompletionStrategy::TABLE_REF:
            return NAME_SCORE_TABLE_REF;
        case buffers::completion::CompletionStrategy::COLUMN_REF:
            return NAME_SCORE_COLUMN_REF;
    }
}

void Completion::SelectTopCandidates() {
    // Resolve the scoring table
    auto& base_scoring_table = selectNameScoringTable(strategy);

    /// Helper to sort catalog objects
    struct CandidateObjectRef {
        std::reference_wrapper<CandidateCatalogObject> candidate_object;
        ScoreValueType score;
        CandidateObjectRef(CandidateCatalogObject& c) : candidate_object(c), score(c.score) {}
        bool operator<(const CandidateObjectRef& other) const { return score < other.score; }
    };
    // Use a heap to collect the top catalog objects for a candidate
    TopKHeap<CandidateObjectRef> catalog_object_heap{24};

    // Insert all pending candidates into the heap
    candidates.ForEach([&](size_t i, Candidate& candidate) {
        // Derive the base score as maximum among the name tags
        Completion::ScoreValueType base_score = 0;
        for (auto [tag, tag_score] : base_scoring_table) {
            base_score = std::max(base_score, candidate.coarse_name_tags.contains(tag) ? tag_score : 0);
        }
        // Then find the top n best candidate objects.
        // Splitting off the base score ensures that we're not depending on resolving catalog objects too much.
        catalog_object_heap.Clear();
        for (auto& o : candidate.catalog_objects) {
            o.score = computeCandidateScore(o.candidate_tags);
            catalog_object_heap.Insert(CandidateObjectRef(o));
        }
        auto& candidate_objects = catalog_object_heap.Finish();

        // Store as new list
        candidate.catalog_objects.Clear();
        for (auto& co : candidate_objects) {
            candidate.catalog_objects.PushBackUnsafe(co.candidate_object.get());
        }

        // Determine overall candidate score
        Completion::ScoreValueType object_score = !candidate_objects.empty() ? candidate_objects.back().score : 0;
        Completion::ScoreValueType candidate_score = base_score + object_score;
        candidate.score = candidate_score;

        // Apply all score modifiers
        // Add the scored candidate
        candidate_heap.Insert(std::move(candidate));
    });

    // Finish the heap
    candidate_heap.Finish();

    // Collect result entries
    auto& entries = candidate_heap.GetEntries();
    top_candidates.reserve(entries.size());
    for (auto& entry : entries) {
        top_candidates.emplace_back(entry);
    }
}

void Completion::FindIdentifierSnippetsForTopCandidates(ScriptRegistry& registry) {
    for (auto& entry : top_candidates) {
        // Process all catalog objects for a result candidate
        for (auto& obj : entry.catalog_objects) {
            switch (obj.catalog_object.GetObjectType()) {
                case CatalogObjectType::ColumnDeclaration: {
                    registry.CollectColumnRestrictions(obj.catalog_object.object_id, std::nullopt,
                                                       entry.restriction_snippets);
                    registry.CollectColumnTransforms(obj.catalog_object.object_id, std::nullopt,
                                                     entry.transform_snippets);
                    break;
                }
                default:
                    break;
            }
        }
    }
}

void Completion::DeriveKeywordSnippetsForTopCandidates() {
    // XXX
}

void Completion::QualifyTopCandidates() {
    // Remember the column candidates by the table that defines them.
    // We later probe this map with all tables in the the current scope to find table refs with aliases.
    std::unordered_multimap<QualifiedCatalogObjectID, std::reference_wrapper<CandidateCatalogObject>>
        column_candidates_by_table_id;

    // Any ambiguities among the candidate objects?
    for (auto& top_candidate : top_candidates) {
        size_t column_count = 0;
        size_t table_count = 0;
        for (auto& co : top_candidate.catalog_objects) {
            column_count += co.catalog_object_id.GetType() == CatalogObjectType::ColumnDeclaration;
            table_count += co.catalog_object_id.GetType() == CatalogObjectType::TableDeclaration;

            switch (co.catalog_object_id.GetType()) {
                case CatalogObjectType::ColumnDeclaration: {
                    auto table_id = QualifiedCatalogObjectID::Table(co.catalog_object_id.UnpackTableColumnID().first);
                    column_candidates_by_table_id.insert({table_id, co});
                    break;
                }
                case CatalogObjectType::TableDeclaration: {
                    auto& table = co.catalog_object.CastUnsafe<CatalogEntry::TableDeclaration>();
                    co.qualified_name = GetQualifiedTableName(table.table_name);
                    co.qualified_name_target_idx = co.qualified_name.size() - 1;
                    break;
                }
                default:
                    break;
            }
        }
        top_candidate.prefer_qualified_columns = column_count > 1;
        top_candidate.prefer_qualified_tables = table_count > 1;
    }

    // Iterate over all cursor name scopes
    for (auto& name_scope : cursor.name_scopes) {
        auto& scope = name_scope.get();
        for (auto& table_ref : scope.table_references) {
            // Read the relation expression
            auto* rel_expr = std::get_if<AnalyzedScript::TableReference::RelationExpression>(&table_ref.inner);
            if (!rel_expr || !rel_expr->resolved_table.has_value()) {
                continue;
            }

            // We found a resolved table in the name scope.
            // Check if any of the column candidates is referencing this table.
            // If yes, check if that table ref has an alias.
            // If yes, qualify the column candidate with that alias.
            auto& resolved = rel_expr->resolved_table.value();
            auto [matches_begin, matches_end] = column_candidates_by_table_id.equal_range(resolved.catalog_table_id);
            bool has_match = matches_begin != matches_end;

            for (auto iter = matches_begin; iter != matches_end; ++iter) {
                auto& co = iter->second.get();

                // Table ref has an alias?
                // Store the qualified name.
                if (table_ref.alias_name.has_value()) {
                    auto& alias = table_ref.alias_name.value().get();
                    auto column = co.catalog_object.CastUnsafe<CatalogEntry::TableColumn>();
                    auto& column_name = column.column_name.get();
                    co.qualified_name = GetQualifiedColumnName(alias, column_name);
                    co.qualified_name_target_idx = co.qualified_name.size() - 1;
                } else {
                    auto column = co.catalog_object.CastUnsafe<CatalogEntry::TableColumn>();
                    auto& column_name = column.column_name.get();
                    co.qualified_name = GetQualifiedColumnName(resolved.table_name, column_name);
                    co.qualified_name_target_idx = co.qualified_name.size() - 1;
                }
            }
            if (has_match) {
                column_candidates_by_table_id.erase(resolved.catalog_table_id);
            }
        }
    }
}

static buffers::completion::CompletionStrategy selectStrategy(const ScriptCursor& cursor) {
    return std::visit(
        [](const auto& ctx) -> buffers::completion::CompletionStrategy {
            using T = std::decay_t<decltype(ctx)>;
            if constexpr (std::is_same_v<T, ScriptCursor::TableRefContext>) {
                return buffers::completion::CompletionStrategy::TABLE_REF;
            } else if constexpr (std::is_same_v<T, ScriptCursor::ColumnRefContext>) {
                return buffers::completion::CompletionStrategy::COLUMN_REF;
            } else {
                return buffers::completion::CompletionStrategy::DEFAULT;
            }
        },
        cursor.context);
}

Completion::Completion(const ScriptCursor& cursor, size_t k)
    : cursor(cursor), strategy(selectStrategy(cursor)), candidate_heap(k) {}

std::pair<std::unique_ptr<Completion>, buffers::status::StatusCode> Completion::Compute(const ScriptCursor& cursor,
                                                                                        size_t k,
                                                                                        ScriptRegistry* registry) {
    auto completion = std::make_unique<Completion>(cursor, k);

    // Skip completion for the current symbol?
    if (doNotCompleteSymbol(cursor.scanner_location->symbol)) {
        return {std::move(completion), buffers::status::StatusCode::OK};
    }

    // XXX Always read name path for qualified location?

    // Is the current symbol an inner dot?
    completion->dot_completion = false;
    if (cursor.scanner_location->currentSymbolIsDot()) {
        using RelativePosition = ScannedScript::LocationInfo::RelativePosition;
        switch (cursor.scanner_location->relative_pos) {
            case RelativePosition::NEW_SYMBOL_AFTER:
            case RelativePosition::END_OF_SYMBOL:
                completion->dot_completion = true;
                break;
            case RelativePosition::BEGIN_OF_SYMBOL:
            case RelativePosition::MID_OF_SYMBOL:
            case RelativePosition::NEW_SYMBOL_BEFORE:
                // Don't complete the dot itself
                return {std::move(completion), buffers::status::StatusCode::OK};
        }
    }

    // Is the current symbol a trailing dot?
    else if (cursor.scanner_location->currentSymbolIsTrailingDot()) {
        using RelativePosition = ScannedScript::LocationInfo::RelativePosition;
        switch (cursor.scanner_location->relative_pos) {
            case RelativePosition::NEW_SYMBOL_AFTER:
            case RelativePosition::END_OF_SYMBOL:
                completion->dot_completion = true;
                break;
            case RelativePosition::BEGIN_OF_SYMBOL:
            case RelativePosition::MID_OF_SYMBOL:
            case RelativePosition::NEW_SYMBOL_BEFORE: {
                // Don't complete the dot itself
                return {std::move(completion), buffers::status::StatusCode::OK};
            }
        }
    }

    // When not dot-completing, find the expected symbols at this location
    bool expects_identifier = false;
    std::vector<parser::Parser::ExpectedSymbol> expected_symbols;
    if (!completion->dot_completion) {
        if (cursor.scanner_location->relative_pos == ScannedScript::LocationInfo::RelativePosition::NEW_SYMBOL_AFTER &&
            !cursor.scanner_location->at_eof) {
            expected_symbols =
                parser::Parser::ParseUntil(*cursor.script.scanned_script, cursor.scanner_location->symbol_id + 1);
        } else {
            expected_symbols =
                parser::Parser::ParseUntil(*cursor.script.scanned_script, cursor.scanner_location->symbol_id);
        }
        for (auto& expected : expected_symbols) {
            if (expected == parser::Parser::symbol_kind_type::S_IDENT) {
                expects_identifier = true;
                break;
            }
        }
    }

    // Is the previous symbol an inner dot?
    // Then we check if we're currently pointing at the successor symbol.
    // If we do, we do a normal dot completion.
    //
    // Note that this is building around the existence of the trailing dot.
    // We're checking here if the previous symbol is an inner dot.
    // If there was a whitespace after the previous dot, we'd mark as at trailing.
    // Since the previous symbol is a normal dot, it must be an inner.
    if (cursor.scanner_location->previousSymbolIsDot() && expects_identifier) {
        using RelativePosition = ScannedScript::LocationInfo::RelativePosition;
        switch (cursor.scanner_location->relative_pos) {
            case RelativePosition::END_OF_SYMBOL:
            case RelativePosition::BEGIN_OF_SYMBOL:
            case RelativePosition::MID_OF_SYMBOL:
                completion->dot_completion = true;
                break;
            case RelativePosition::NEW_SYMBOL_AFTER:
            case RelativePosition::NEW_SYMBOL_BEFORE:
                /// NEW_SYMBOL_BEFORE should be unreachable, the previous symbol would have been a trailing dot...
                /// NEW_SYMBOL_AFTER is not qualifying for dot completion

                // Proceed with normal completion...
                break;
        }
    }

    // Dot completion?
    if (completion->dot_completion) {
        // Restricting candidates to the dot context
        completion->FindCandidatesForNamePath();
    } else {
        // Add expected grammar symbols to the heap and score them
        completion->AddExpectedKeywordsAsCandidates(expected_symbols);
        // Also check the name indexes when expecting an identifier
        if (expects_identifier) {
            // Just find all candidates in the name index
            completion->FindCandidatesInIndexes();
            // Promote names of all tables that could resolve an unresolved column
            completion->PromoteTablesAndPeersForUnresolvedColumns();
        }
    }
    // Promote names that are in scope
    completion->PromoteIdentifiersInScope();
    // Promote names that we've used before
    if (registry) {
        completion->PromoteIdentifiersInScripts(*registry);
    }
    // Add all candidates to the result heap
    completion->SelectTopCandidates();
    // Get qualified names for the top candidate objects
    completion->QualifyTopCandidates();
    // Find identifier snippets for the completion result
    if (registry) {
        completion->FindIdentifierSnippetsForTopCandidates(*registry);
    }
    // Derive keyword snippets (if any)
    completion->DeriveKeywordSnippetsForTopCandidates();

    // Register as normal completion
    return {std::move(completion), buffers::status::StatusCode::OK};
}

flatbuffers::Offset<buffers::completion::Completion> Completion::Pack(flatbuffers::FlatBufferBuilder& builder) {
    auto& entries = top_candidates;

    // Reservie for packed candidates
    std::vector<flatbuffers::Offset<buffers::completion::CompletionCandidate>> candidates;
    candidates.reserve(entries.size());

    std::vector<flatbuffers::Offset<buffers::snippet::ScriptTemplate>> script_templates;
    std::vector<flatbuffers::Offset<buffers::snippet::ScriptSnippet>> script_snippets;

    // Pack candidates
    for (auto iter_entry = entries.begin(); iter_entry != entries.end(); ++iter_entry) {
        // Do we have to quote the completion text?
        auto display_text_offset = builder.CreateString(iter_entry->completion_text);
        std::string quoted;
        std::string_view completion_text = iter_entry->completion_text;
        completion_text = quote_anyupper_fuzzy(completion_text, quoted);

        // Resolve the catalog objects
        size_t catalog_object_count = iter_entry->catalog_objects.GetSize();
        std::vector<flatbuffers::Offset<buffers::completion::CompletionCandidateObject>> catalog_objects;
        catalog_objects.reserve(catalog_object_count);

        // Pack the catalog objects
        std::vector<flatbuffers::Offset<flatbuffers::String>> qualified_name_offsets;
        std::string qualified_name_buffer;
        for (auto& co : iter_entry->catalog_objects) {
            auto& o = co.catalog_object;

            // Pack qualified name
            qualified_name_offsets.clear();
            for (auto& n : co.qualified_name) {
                auto ofs = builder.CreateString(quote_anyupper_fuzzy(n, qualified_name_buffer));
                qualified_name_offsets.push_back(ofs);
            }
            auto qualified_names_ofs = builder.CreateVector(qualified_name_offsets);

            // Pack candidate object
            buffers::completion::CompletionCandidateObjectBuilder obj{builder};
            obj.add_object_type(static_cast<buffers::completion::CompletionCandidateObjectType>(o.GetObjectType()));
            obj.add_candidate_tags(co.candidate_tags);
            obj.add_score(co.score);
            obj.add_qualified_name(qualified_names_ofs);
            obj.add_qualified_name_target_idx(co.qualified_name_target_idx);
            switch (o.GetObjectType()) {
                case CatalogObjectType::DatabaseReference: {
                    auto& db = o.CastUnsafe<CatalogEntry::DatabaseReference>();
                    obj.add_catalog_database_id(db.GetDatabaseID());
                    break;
                }
                case CatalogObjectType::SchemaReference: {
                    auto& schema = o.CastUnsafe<CatalogEntry::SchemaReference>();
                    obj.add_catalog_database_id(schema.GetDatabaseID());
                    obj.add_catalog_schema_id(schema.GetSchemaID());
                    break;
                }
                case CatalogObjectType::TableDeclaration: {
                    auto& table = o.CastUnsafe<CatalogEntry::TableDeclaration>();
                    auto [db_id, schema_id] = table.catalog_schema_id.UnpackSchemaID();
                    obj.add_catalog_database_id(db_id);
                    obj.add_catalog_schema_id(schema_id);
                    obj.add_catalog_table_id(table.object_id.UnpackTableID().Pack());
                    obj.add_referenced_catalog_version(table.catalog_version);
                    break;
                }
                case CatalogObjectType::ColumnDeclaration: {
                    auto& column = o.CastUnsafe<CatalogEntry::TableColumn>();
                    auto& table = column.table->get();
                    auto [db_id, schema_id] = table.catalog_schema_id.UnpackSchemaID();
                    auto [table_id, column_idx] = table.object_id.UnpackTableColumnID();
                    obj.add_catalog_database_id(db_id);
                    obj.add_catalog_schema_id(schema_id);
                    obj.add_catalog_table_id(table_id.Pack());
                    obj.add_table_column_id(column_idx);
                    obj.add_referenced_catalog_version(table.catalog_version);
                    break;
                }
                case CatalogObjectType::Deferred: {
                    assert(false);
                    break;
                }
            }
            catalog_objects.push_back(obj.Finish());
        }

        // Pack script templates
        script_templates.clear();
        script_templates.reserve(iter_entry->restriction_snippets.size() + iter_entry->transform_snippets.size());

        auto collect_templates = [&](const ScriptRegistry::SnippetMap& snippets,
                                     buffers::snippet::ScriptTemplateType type,
                                     std::vector<flatbuffers::Offset<buffers::snippet::ScriptTemplate>>& out,
                                     std::vector<flatbuffers::Offset<buffers::snippet::ScriptSnippet>>& tmp_snippets) {
            for (auto& [k, vs] : snippets) {
                assert(!vs.empty());
                tmp_snippets.clear();
                tmp_snippets.reserve(vs.size());
                for (auto& v : vs) {
                    tmp_snippets.push_back(v->Pack(builder));
                }
                auto script_snippets_ofs = builder.CreateVector(tmp_snippets);

                buffers::snippet::ScriptTemplateBuilder template_builder{builder};
                template_builder.add_template_signature(k.signature);
                template_builder.add_template_type(type);
                template_builder.add_snippets(script_snippets_ofs);
                out.push_back(template_builder.Finish());
            }
        };
        collect_templates(iter_entry->restriction_snippets, buffers::snippet::ScriptTemplateType::COLUMN_RESTRICTION,
                          script_templates, script_snippets);
        collect_templates(iter_entry->transform_snippets, buffers::snippet::ScriptTemplateType::COLUMN_TRANSFORM,
                          script_templates, script_snippets);
        auto templates_ofs = builder.CreateVector(script_templates);

        auto catalog_objects_ofs = builder.CreateVector(catalog_objects);
        auto completion_text_ofs = builder.CreateString(completion_text);
        buffers::completion::CompletionCandidateBuilder candidate_builder{builder};
        candidate_builder.add_display_text(display_text_offset);
        candidate_builder.add_completion_text(completion_text_ofs);
        candidate_builder.add_candidate_tags(iter_entry->candidate_tags);
        candidate_builder.add_name_tags(iter_entry->coarse_name_tags);
        candidate_builder.add_catalog_objects(catalog_objects_ofs);
        candidate_builder.add_score(iter_entry->score);
        candidate_builder.add_target_location(&iter_entry->target_location);
        candidate_builder.add_target_location_qualified(&iter_entry->target_location_qualified);
        candidate_builder.add_completion_templates(templates_ofs);
        candidates.push_back(candidate_builder.Finish());
    }
    auto candidatesOfs = builder.CreateVector(candidates);

    // Pack completion table
    buffers::completion::CompletionBuilder completion_builder{builder};
    completion_builder.add_cursor_offset(cursor.text_offset);
    completion_builder.add_dot_completion(dot_completion);
    completion_builder.add_strategy(strategy);
    completion_builder.add_candidates(candidatesOfs);
    return completion_builder.Finish();
}

}  // namespace dashql
