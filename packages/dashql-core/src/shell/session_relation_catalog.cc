#include "dashql/shell/session_relation_catalog.h"

#include <cstdint>
#include <optional>
#include <sstream>
#include <utility>

#include "dashql/catalog.h"
#include "dashql/script.h"

namespace dashql::shell {
namespace {

using StatementType = buffers::parser::StatementType;

constexpr uint32_t SESSION_RELATION_CATALOG_RANK = 9998;
constexpr std::string_view SESSION_SCHEMA = "public";
constexpr std::string_view CATALOG_HEADER = "-- Relations created during this shell session.";

std::string QuoteIdentifier(std::string_view identifier) {
    std::string quoted;
    quoted.reserve(identifier.size() + 2);
    quoted.push_back('"');
    for (const auto character : identifier) {
        quoted.push_back(character);
        if (character == '"') quoted.push_back('"');
    }
    quoted.push_back('"');
    return quoted;
}

struct StatementTarget {
    std::string database_name;
    std::string schema_name;
    std::string relation_name;
};

std::optional<StatementTarget> ReadTarget(const ParsedScript& parsed, size_t statement_id) {
    const auto statement = parsed.PackStatement(statement_id);
    const auto* target = statement->target.get();
    if (target == nullptr || target->relation_name.empty()) {
        return std::nullopt;
    }
    return StatementTarget{
        .database_name = target->database_name,
        .schema_name = target->schema_name.empty() ? std::string{SESSION_SCHEMA} : target->schema_name,
        .relation_name = target->relation_name,
    };
}

}  // namespace

SessionRelationCatalog::SessionRelationCatalog(Catalog& catalog)
    : catalog_{catalog},
      parser_script_{std::make_unique<Script>(catalog)},
      catalog_script_{std::make_unique<Script>(catalog)} {
    catalog_script_->ReplaceText(CATALOG_HEADER);
}

SessionRelationCatalog::~SessionRelationCatalog() = default;

void SessionRelationCatalog::ApplySuccessfulQuery(std::string_view query) {
    parser_script_->ReplaceText(query);
    parser_script_->Analyze();
    const auto& parsed = parser_script_->GetParsedScript();
    const auto& analyzed = parser_script_->GetAnalyzedScript();
    if (parsed == nullptr || analyzed == nullptr || !parsed->errors.empty() ||
        !parsed->scanned_script->errors.empty() || parsed->statements.size() != 1) {
        return;
    }

    const auto statement_type = parsed->statements.front().type;
    switch (statement_type) {
        case StatementType::CREATE_TABLE:
        case StatementType::CREATE_TABLE_AS:
        case StatementType::CREATE_VIEW:
        case StatementType::SELECT_INTO:
        case StatementType::DROP_TABLE:
        case StatementType::DROP_VIEW:
            break;
        default:
            return;
    }

    const auto target = ReadTarget(*parsed, 0);
    if (!target.has_value()) return;
    RelationKey key{target->database_name, target->schema_name, target->relation_name};

    if (statement_type == StatementType::DROP_TABLE || statement_type == StatementType::DROP_VIEW) {
        relations_.erase(key);
    } else {
        Relation relation{
            .database_name = target->database_name,
            .schema_name = target->schema_name,
            .relation_name = target->relation_name,
        };
        for (const auto& table_chunk : analyzed->GetTables().GetChunks()) {
            for (const auto& table : table_chunk) {
                if (table.table_name.database_name.get().text != relation.database_name ||
                    (table.table_name.schema_name.get().text.empty()
                         ? SESSION_SCHEMA
                         : table.table_name.schema_name.get().text) != relation.schema_name ||
                    table.table_name.table_name.get().text != relation.relation_name) {
                    continue;
                }
                relation.columns.reserve(table.table_columns.size());
                for (const auto& column : table.table_columns) {
                    relation.columns.emplace_back(column.column_name.get().text);
                }
                break;
            }
        }
        relations_.insert_or_assign(std::move(key), std::move(relation));
    }
    ReloadCatalogScript();
}

void SessionRelationCatalog::ReloadCatalogScript() {
    catalog_script_->ReplaceText(RenderCatalog());
    catalog_script_->Analyze();
    catalog_.DropScript(*catalog_script_);
    catalog_.LoadScript(*catalog_script_, SESSION_RELATION_CATALOG_RANK);
}

std::string SessionRelationCatalog::RenderCatalog() const {
    std::ostringstream output;
    output << CATALOG_HEADER;
    for (const auto& [_, relation] : relations_) {
        output << "\n\nCREATE TABLE ";
        if (!relation.database_name.empty()) output << QuoteIdentifier(relation.database_name) << '.';
        output << QuoteIdentifier(relation.schema_name) << '.' << QuoteIdentifier(relation.relation_name) << " (\n";
        for (size_t i = 0; i < relation.columns.size(); ++i) {
            if (i != 0) output << ",\n";
            output << "    " << QuoteIdentifier(relation.columns[i]) << " VARCHAR";
        }
        output << "\n);";
    }
    return output.str();
}

}  // namespace dashql::shell
