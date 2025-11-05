#include "dashql/script_registry.h"

#include <variant>

#include "dashql/buffers/index_generated.h"
#include "dashql/catalog_object.h"

namespace dashql {

void ScriptRegistry::Clear() {}

void ScriptRegistry::DropScript(Script& script) {}

buffers::status::StatusCode ScriptRegistry::AddScript(Script& script) {
    if (!script.analyzed_script) {
        return buffers::status::StatusCode::SCRIPT_NOT_ANALYZED;
    }
    auto& analyzed = *script.analyzed_script;
    script_entries.erase(&script);
    script_entries.emplace(&script, ScriptEntry{.script = script, .analyzed = script.analyzed_script});

    analyzed.column_restrictions.ForEach([&](size_t i, AnalyzedScript::ColumnRestriction& restriction) {
        auto& column_ref = std::get<AnalyzedScript::Expression::ColumnRef>(restriction.column_ref.get().inner);
        if (column_ref.resolved_column.has_value()) {
            auto& col = column_ref.resolved_column.value();
            std::pair<QualifiedCatalogObjectID, const Script*> entry{col.catalog_table_column_id, &script};
            column_restrictions.insert(entry);
        }
    });
    analyzed.column_computations.ForEach([&](size_t i, AnalyzedScript::ColumnTransform& computation) {
        auto& column_ref = std::get<AnalyzedScript::Expression::ColumnRef>(computation.column_ref.get().inner);
        if (column_ref.resolved_column.has_value()) {
            auto& col = column_ref.resolved_column.value();
            std::pair<QualifiedCatalogObjectID, const Script*> entry{col.catalog_table_column_id, &script};
            column_computations.insert(entry);
        }
    });

    return buffers::status::StatusCode::OK;
}

std::vector<ScriptRegistry::IndexedColumnRestriction> ScriptRegistry::FindColumnRestrictions(
    QualifiedCatalogObjectID column_id, std::optional<CatalogVersion> target_catalog_version) {
    // Collect column restrictions
    std::vector<ScriptRegistry::IndexedColumnRestriction> lookup;
    // Track outdated refs
    std::vector<std::pair<QualifiedCatalogObjectID, const Script*>> outdated;

    // Search the qualified column id
    auto iter = column_restrictions.lower_bound({column_id, nullptr});
    // Iterate over restrictions
    for (; iter != column_restrictions.end(); ++iter) {
        // Same key?
        auto [iter_column, iter_script] = iter.key();
        if (iter_column != column_id) {
            break;
        }
        // Script still alive?
        auto script_iter = script_entries.find(iter_script);
        if (script_iter == script_entries.end()) {
            continue;
        }
        auto& script_entry = script_iter->second;
        auto analyzed = script_entry.analyzed;
        assert(analyzed != nullptr);

        // Collect restrictions in the analyzed script
        auto [b, e] = analyzed->column_restrictions_by_catalog_entry.equal_range({column_id});
        for (auto r_iter = b; r_iter != e; ++r_iter) {
            auto& restriction = r_iter->second.get();

            // Unpack the column ref
            auto& column_ref_expr = restriction.column_ref.get();
            assert(std::holds_alternative<AnalyzedScript::Expression::ColumnRef>(column_ref_expr.inner));
            auto& column_ref = std::get<AnalyzedScript::Expression::ColumnRef>(column_ref_expr.inner);

            // If it is resolved, check the catalog_version.
            // If it is older than the provided catalog version, we know that the analyzed script is outdated.
            // (We are here looking up a column ref that was registered with the catalog at a later point than this ref)
            if (auto& resolved = column_ref.resolved_column) {
                if (target_catalog_version.has_value() &&
                    resolved->referenced_catalog_version != target_catalog_version.value()) {
                    outdated.emplace_back(column_id, &script_entry.script);
                    break;
                }
            }

            lookup.emplace_back(script_entry.script, *script_entry.analyzed, restriction);
        }
    }

    // Remove outdated from the index.
    // Note that we're only dropping the outdated column ref here.
    // Other column refs from these scripts might still be valid after all.
    for (auto& key : outdated) {
        column_restrictions.erase(key);
    }

    return lookup;
}

std::vector<ScriptRegistry::IndexedColumnTransform> ScriptRegistry::FindColumnTransforms(
    QualifiedCatalogObjectID column_id, std::optional<CatalogVersion> target_catalog_version) {
    // Collect column computations
    std::vector<ScriptRegistry::IndexedColumnTransform> lookup;
    // Track outdated refs
    std::vector<std::pair<QualifiedCatalogObjectID, const Script*>> outdated;

    // Search the qualified column id
    auto iter = column_computations.lower_bound({column_id, nullptr});
    // Iterate over restrictions
    for (; iter != column_computations.end(); ++iter) {
        // Same key?
        auto [iter_column, iter_script] = iter.key();
        if (iter_column != column_id) {
            break;
        }
        // Script still alive?
        auto script_iter = script_entries.find(iter_script);
        if (script_iter == script_entries.end()) {
            continue;
        }
        auto& script_entry = script_iter->second;
        auto analyzed = script_entry.analyzed;
        assert(analyzed != nullptr);

        // Collect computations in the analyzed script
        auto [b, e] = analyzed->column_computations_by_catalog_entry.equal_range({column_id});
        for (auto r_iter = b; r_iter != e; ++r_iter) {
            auto& computation = r_iter->second.get();

            // Unpack the column ref
            auto& column_ref_expr = computation.column_ref.get();
            assert(std::holds_alternative<AnalyzedScript::Expression::ColumnRef>(column_ref_expr.inner));
            auto& column_ref = std::get<AnalyzedScript::Expression::ColumnRef>(column_ref_expr.inner);

            // If it is resolved, check the catalog_version.
            // If it is older than the provided catalog version, we know that the analyzed script is outdated.
            // (We are here looking up a column ref that was registered with the catalog at a later point than this ref)
            if (auto& resolved = column_ref.resolved_column) {
                if (target_catalog_version.has_value() &&
                    resolved->referenced_catalog_version != target_catalog_version.value()) {
                    outdated.emplace_back(column_id, &script_entry.script);
                    break;
                }
            }

            lookup.emplace_back(script_entry.script, *script_entry.analyzed, computation);
        }
    }

    // Remove outdated from the index.
    // Note that we're only dropping the outdated column ref here.
    // Other column refs from these scripts might still be valid after all.
    for (auto& key : outdated) {
        column_computations.erase(key);
    }
    return lookup;
}

/// Helper to add a snippets to grouped snippets
static bool addSnippetToGroup(ScriptSnippet snippet, ScriptRegistry::SnippetMap& snippets,
                              bool deduplicate_similar = false) {
    auto snippet_ptr = std::make_unique<ScriptSnippet>(std::move(snippet));
    auto& snippet_ref = *snippet_ptr;
    auto snippet_key = ScriptSnippet::Key<true>{snippet_ref};

    // Did we index a similar snippet already?
    auto iter = snippets.find(snippet_key);
    if (iter != snippets.end()) {
        // Deduplicate snippets eagerly
        if (iter->second.back()->Equals(*snippet_ptr, deduplicate_similar)) {
            return false;
        } else {
            // Otherwise remember the snippet
            iter->second.push_back(std::move(snippet_ptr));
            return true;
        }
    } else {
        // Otherwise start a new entry
        std::vector<std::unique_ptr<ScriptSnippet>> same_key;
        same_key.reserve(1);
        same_key.push_back(std::move(snippet_ptr));
        snippets.insert({snippet_key, std::move(same_key)});
        return true;
    }
};

flatbuffers::Offset<buffers::registry::ScriptRegistryColumnInfo> ScriptRegistry::FindColumnInfo(
    flatbuffers::FlatBufferBuilder& builder, QualifiedCatalogObjectID column_id,
    std::optional<CatalogVersion> target_catalog_version) {
    // Helper to add a snippet
    using SnippetMap = std::unordered_map<ScriptSnippet::Key<true>, std::vector<std::unique_ptr<ScriptSnippet>>>;

    // Helper to pack templates
    auto pack_templates = [](flatbuffers::FlatBufferBuilder& builder, const SnippetMap& snippet_map,
                             buffers::snippet::ScriptTemplateType type) {
        std::vector<flatbuffers::Offset<buffers::snippet::ScriptTemplate>> templates;
        std::vector<flatbuffers::Offset<buffers::snippet::ScriptSnippet>> template_snippets;

        for (auto& [snippet_key, snippets] : snippet_map) {
            template_snippets.clear();
            template_snippets.reserve(snippets.size());
            for (auto& snippet : snippets) {
                template_snippets.push_back(snippet->Pack(builder));
            }
            auto template_snippets_ofs = builder.CreateVector(template_snippets);

            buffers::snippet::ScriptTemplateBuilder template_builder{builder};
            template_builder.add_template_signature(snippet_key.hash());
            template_builder.add_template_type(type);
            template_builder.add_snippets(template_snippets_ofs);
            templates.push_back(template_builder.Finish());
        }
        return templates;
    };

    using FlatTemplateVector =
        flatbuffers::Offset<flatbuffers::Vector<flatbuffers::Offset<buffers::snippet::ScriptTemplate>>>;

    FlatTemplateVector restriction_templates;
    {
        // Find all column restrictions
        auto restrictions = FindColumnRestrictions(column_id, target_catalog_version);

        // Group restrictions snippets
        SnippetMap restriction_snippets;
        for (auto& [script_ref, analyzed_ref, restriction_ref] : restrictions) {
            auto& root = restriction_ref.get().root.get();
            auto& analyzed = analyzed_ref.get();
            auto& parsed = *analyzed.parsed_script;
            auto& scanned = *parsed.scanned_script;
            auto snippet = ScriptSnippet::Extract(scanned.text_buffer, parsed.nodes, analyzed.node_markers,
                                                  root.ast_node_id, scanned.GetNames());
            addSnippetToGroup(std::move(snippet), restriction_snippets);
        };

        // Pack the restriction templates
        auto templates =
            pack_templates(builder, restriction_snippets, buffers::snippet::ScriptTemplateType::COLUMN_RESTRICTION);
        restriction_templates = builder.CreateVector(templates);
    }

    FlatTemplateVector computation_templates;
    {
        // Find all column computations
        auto computations = FindColumnTransforms(column_id, target_catalog_version);

        // Group computation snippets
        SnippetMap computation_snippets;
        for (auto& [script_ref, analyzed_ref, computation_ref] : computations) {
            auto& root = computation_ref.get().root.get();
            auto& analyzed = analyzed_ref.get();
            auto& parsed = *analyzed.parsed_script;
            auto& scanned = *parsed.scanned_script;
            auto snippet = ScriptSnippet::Extract(scanned.text_buffer, parsed.nodes, analyzed.node_markers,
                                                  root.ast_node_id, scanned.GetNames());
            addSnippetToGroup(std::move(snippet), computation_snippets);
        };

        // Pack the restriction templates
        auto templates =
            pack_templates(builder, computation_snippets, buffers::snippet::ScriptTemplateType::COLUMN_TRANSFORM);
        computation_templates = builder.CreateVector(templates);
    }

    buffers::registry::ScriptRegistryColumnInfoBuilder info_builder{builder};
    info_builder.add_restriction_templates(restriction_templates);
    info_builder.add_computation_templates(computation_templates);
    return info_builder.Finish();
}

void ScriptRegistry::CollectColumnRestrictions(QualifiedCatalogObjectID column_id,
                                               std::optional<CatalogVersion> target_catalog_version, SnippetMap& out) {
    auto restrictions = FindColumnRestrictions(column_id, target_catalog_version);
    for (auto& [script_ref, analyzed_ref, restriction_ref] : restrictions) {
        auto& root = restriction_ref.get().root.get();
        auto& analyzed = analyzed_ref.get();
        auto& parsed = *analyzed.parsed_script;
        auto& scanned = *parsed.scanned_script;

        auto snippet = ScriptSnippet::Extract(scanned.text_buffer, parsed.nodes, analyzed.node_markers,
                                              root.ast_node_id, scanned.GetNames());

        addSnippetToGroup(std::move(snippet), out);
    }
}

void ScriptRegistry::CollectColumnTransforms(QualifiedCatalogObjectID column_id,
                                             std::optional<CatalogVersion> target_catalog_version, SnippetMap& out) {
    size_t n = 0;
    auto computations = FindColumnTransforms(column_id, target_catalog_version);
    for (auto& [script_ref, analyzed_ref, restriction_ref] : computations) {
        auto& root = restriction_ref.get().root.get();
        auto& analyzed = analyzed_ref.get();
        auto& parsed = *analyzed.parsed_script;
        auto& scanned = *parsed.scanned_script;

        auto snippet = ScriptSnippet::Extract(scanned.text_buffer, parsed.nodes, analyzed.node_markers,
                                              root.ast_node_id, scanned.GetNames());

        addSnippetToGroup(std::move(snippet), out);
    }
}

}  // namespace dashql
