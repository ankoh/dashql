#include "dashql/script_registry.h"

#include <variant>

#include "dashql/buffers/index_generated.h"
#include "dashql/script_snippet.h"

namespace dashql {

void ScriptRegistry::Clear() {}

void ScriptRegistry::DropScript(Script& script) {}

buffers::status::StatusCode ScriptRegistry::AddScript(Script& script) {
    if (!script.analyzed_script) {
        return buffers::status::StatusCode::SCRIPT_NOT_ANALYZED;
    }
    auto& analyzed = *script.analyzed_script;

    return buffers::status::StatusCode::OK;
}

std::vector<ScriptRegistry::IndexedColumnRestriction> ScriptRegistry::FindColumnRestrictions(
    ContextObjectID table, ColumnID column_id, CatalogVersion target_catalog_version) {
    // Collect column restrictions
    std::vector<ScriptRegistry::IndexedColumnRestriction> lookup;
    // Track outdated refs
    std::vector<std::tuple<ContextObjectID, ColumnID, const Script*>> outdated;

    // Search the qualified column id
    auto iter = column_restrictions.lower_bound({table, column_id, nullptr});
    // Iterate over restrictions
    for (; iter != column_restrictions.end(); ++iter) {
        // Same key?
        auto [iter_table, iter_column, iter_script] = iter.key();
        if (iter_table != table && iter_column != column_id) {
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
        auto [b, e] = analyzed->column_restrictions_by_catalog_entry.equal_range({table, column_id});
        for (auto r_iter = b; r_iter != e; ++r_iter) {
            auto& restriction = b->second.get();

            // Unpack the column ref
            auto& column_ref_expr = restriction.column_ref.get();
            assert(std::holds_alternative<AnalyzedScript::Expression::ColumnRef>(column_ref_expr.inner));
            auto& column_ref = std::get<AnalyzedScript::Expression::ColumnRef>(column_ref_expr.inner);

            // If it is resolved, check the catalog_version.
            // If it is older than the provided catalog version, we know that the analyzed script is outdated.
            // (We are here looking up a column ref that was registered with the catalog at a later point than this ref)
            if (auto& resolved = column_ref.resolved_column) {
                if (resolved->referenced_catalog_version < target_catalog_version) {
                    outdated.emplace_back(table, column_id, &script_entry.script);
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
    ContextObjectID table, ColumnID column_id, CatalogVersion target_catalog_version) {
    // Collect column transforms
    std::vector<ScriptRegistry::IndexedColumnTransform> lookup;
    // Track outdated refs
    std::vector<std::tuple<ContextObjectID, ColumnID, const Script*>> outdated;

    // Search the qualified column id
    auto iter = column_transforms.lower_bound({table, column_id, nullptr});
    // Iterate over restrictions
    for (; iter != column_transforms.end(); ++iter) {
        // Same key?
        auto [iter_table, iter_column, iter_script] = iter.key();
        if (iter_table != table && iter_column != column_id) {
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

        // Collect transforms in the analyzed script
        auto [b, e] = analyzed->column_transforms_by_catalog_entry.equal_range({table, column_id});
        for (auto r_iter = b; r_iter != e; ++r_iter) {
            auto& transform = b->second.get();
            lookup.emplace_back(script_entry.script, *script_entry.analyzed, transform);

            // Unpack the column ref
            auto& column_ref_expr = transform.column_ref.get();
            assert(std::holds_alternative<AnalyzedScript::Expression::ColumnRef>(column_ref_expr.inner));
            auto& column_ref = std::get<AnalyzedScript::Expression::ColumnRef>(column_ref_expr.inner);

            // If it is resolved, check the catalog_version.
            // If it is older than the provided catalog version, we know that the analyzed script is outdated.
            // (We are here looking up a column ref that was registered with the catalog at a later point than this ref)
            if (auto& resolved = column_ref.resolved_column) {
                if (resolved->referenced_catalog_version < target_catalog_version) {
                    outdated.emplace_back(table, column_id, &script_entry.script);
                    break;
                }
            }
            lookup.emplace_back(script_entry.script, *script_entry.analyzed, transform);
        }
    }

    // Remove outdated from the index.
    // Note that we're only dropping the outdated column ref here.
    // Other column refs from these scripts might still be valid after all.
    for (auto& key : outdated) {
        column_transforms.erase(key);
    }
    return lookup;
}

flatbuffers::Offset<buffers::registry::ScriptRegistryColumnInfo> ScriptRegistry::FindColumnInfo(
    flatbuffers::FlatBufferBuilder& builder, ContextObjectID table, ColumnID column_id,
    CatalogVersion target_catalog_version) {
    // Helper to add a snippet
    using SnippetMap = std::unordered_map<ScriptSnippet::Key<true>, std::vector<std::unique_ptr<ScriptSnippet>>>;
    auto add_snippet = [](ScriptSnippet snippet, SnippetMap& snippets) {
        auto snippet_ptr = std::make_unique<ScriptSnippet>(std::move(snippet));
        auto& snippet_ref = *snippet_ptr;
        auto snippet_key = ScriptSnippet::Key<true>{snippet_ref};

        // Did we index a similar restriction snippet already?
        auto iter = snippets.find(snippet_key);
        if (iter != snippets.end()) {
            iter->second.push_back(std::move(snippet_ptr));
        } else {
            // Otherwise start a new entry
            std::vector<std::unique_ptr<ScriptSnippet>> same_key;
            same_key.reserve(1);
            same_key.push_back(std::move(snippet_ptr));
            snippets.insert({snippet_key, std::move(same_key)});
        }
    };

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
        auto restrictions = FindColumnRestrictions(table, column_id, target_catalog_version);

        // Group restrictions snippets
        SnippetMap restriction_snippets;
        for (auto& [script_ref, analyzed_ref, restriction_ref] : restrictions) {
            auto& restriction_root = restriction_ref.get().root.get();
            auto& analyzed = analyzed_ref.get();
            auto& parsed = *analyzed.parsed_script;
            auto& scanned = *parsed.scanned_script;
            auto snippet = ScriptSnippet::Extract(scanned.text_buffer, parsed.nodes, analyzed.node_markers,
                                                  restriction_root.ast_node_id, scanned.GetNames());
            add_snippet(std::move(snippet), restriction_snippets);
        };

        // Pack the restriction templates
        auto templates =
            pack_templates(builder, restriction_snippets, buffers::snippet::ScriptTemplateType::COLUMN_RESTRICTION);
        restriction_templates = builder.CreateVector(templates);
    }

    FlatTemplateVector transform_templates;
    {
        // Find all column transforms
        auto transforms = FindColumnTransforms(table, column_id, target_catalog_version);

        // Group transform snippets
        SnippetMap transform_snippets;
        for (auto& [script_ref, analyzed_ref, transform_ref] : transforms) {
            auto& transform_root = transform_ref.get().root.get();
            auto& analyzed = analyzed_ref.get();
            auto& parsed = *analyzed.parsed_script;
            auto& scanned = *parsed.scanned_script;
            auto snippet = ScriptSnippet::Extract(scanned.text_buffer, parsed.nodes, analyzed.node_markers,
                                                  transform_root.ast_node_id, scanned.GetNames());
            add_snippet(std::move(snippet), transform_snippets);
        };

        // Pack the restriction templates
        auto templates =
            pack_templates(builder, transform_snippets, buffers::snippet::ScriptTemplateType::COLUMN_TRANSFORM);
        transform_templates = builder.CreateVector(templates);
    }

    buffers::registry::ScriptRegistryColumnInfoBuilder info_builder{builder};
    info_builder.add_restriction_templates(restriction_templates);
    info_builder.add_transform_templates(transform_templates);
    return info_builder.Finish();
}

}  // namespace dashql
