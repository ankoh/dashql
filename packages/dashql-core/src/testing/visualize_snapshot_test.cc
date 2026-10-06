#include "dashql/testing/visualize_snapshot_test.h"

#include <fstream>
#include <sstream>
#include <unordered_map>

#include "c4/format.hpp"
#include "c4/yml/std/std.hpp"
#include "dashql/testing/runfiles_dir.h"
#include "dashql/utils/string_trimming.h"
#include "ryml.hpp"

namespace dashql::testing {

namespace {

std::string_view MarkdownNodeName(buffers::visualization::MarkdownNodeType type) {
    using NodeType = buffers::visualization::MarkdownNodeType;
    switch (type) {
        case NodeType::DOCUMENT: return "document";
        case NodeType::PARAGRAPH: return "paragraph";
        case NodeType::BLOCKQUOTE: return "blockquote";
        case NodeType::LIST_ITEM: return "listItem";
        case NodeType::EMPHASIS: return "emphasis";
        case NodeType::STRONG: return "strong";
        case NodeType::SPAN: return "span";
        case NodeType::HEADING: return "heading";
        case NodeType::LIST: return "list";
        case NodeType::TEXT: return "text";
        case NodeType::FIELD: return "field";
        case NodeType::INLINE_CODE: return "inlineCode";
        case NodeType::CODE_BLOCK: return "codeBlock";
        case NodeType::LINK: return "link";
        case NodeType::IMAGE: return "image";
        case NodeType::HARD_BREAK: return "hardBreak";
        case NodeType::THEMATIC_BREAK: return "thematicBreak";
        case NodeType::NONE: return "none";
    }
}

void EncodeMarkdownNode(c4::yml::NodeRef out, const visualize::MarkdownNode& node) {
    using NodeType = buffers::visualization::MarkdownNodeType;
    out |= c4::yml::MAP;
    out.append_child() << c4::yml::key("type") << std::string(MarkdownNodeName(node.node_type));
    if (node.node_type == NodeType::TEXT) {
        out.append_child() << c4::yml::key("value") << node.value;
    } else if (node.node_type == NodeType::FIELD) {
        out.append_child() << c4::yml::key("field") << node.value;
    } else if (node.node_type == NodeType::HEADING) {
        out.append_child() << c4::yml::key("level") << node.level;
    } else if (node.node_type == NodeType::LIST) {
        out.append_child() << c4::yml::key("ordered") << c4::fmt::boolalpha(node.ordered);
        out.append_child() << c4::yml::key("tight") << c4::fmt::boolalpha(node.tight);
        if (node.ordered) out.append_child() << c4::yml::key("start") << node.start;
    } else if (node.node_type == NodeType::LINK || node.node_type == NodeType::IMAGE) {
        out.append_child() << c4::yml::key("url") << node.url;
        if (!node.title.empty()) out.append_child() << c4::yml::key("title") << node.title;
    } else if (node.node_type == NodeType::CODE_BLOCK && !node.language.empty()) {
        out.append_child() << c4::yml::key("language") << node.language;
    }
    if (!node.children.empty()) {
        auto children = out.append_child();
        children << c4::yml::key("children");
        children |= c4::yml::SEQ;
        for (const auto& child : node.children) EncodeMarkdownNode(children.append_child(), *child);
    }
}

}  // namespace

void EncodeMarkdownSpec(c4::yml::NodeRef out, const visualize::MarkdownDocument& spec) {
    out |= c4::yml::MAP;
    auto row_template = out.append_child();
    row_template << c4::yml::key("template") << spec.template_;
    if (spec.template_.find('\n') != std::string::npos) row_template.set_val_style(c4::yml::VAL_LITERAL);

    auto fields = out.append_child();
    fields << c4::yml::key("fields");
    fields |= c4::yml::SEQ;
    for (const auto& field : spec.fields) fields.append_child() << field;

    auto document = out.append_child();
    document << c4::yml::key("document");
    EncodeMarkdownNode(document, *spec.document);
}

void EncodeUmapSpec(c4::yml::NodeRef out, const visualize::UmapDocument& spec) {
    out |= c4::yml::MAP;
    out.append_child() << c4::yml::key("vector-column") << spec.vector_column;
    if (!spec.category_column.empty()) {
        out.append_child() << c4::yml::key("category-column") << spec.category_column;
    }
    if (!spec.label_column.empty()) {
        out.append_child() << c4::yml::key("label-column") << spec.label_column;
    }

    auto projection = out.append_child();
    projection << c4::yml::key("projection");
    projection |= c4::yml::MAP;
    projection.append_child() << c4::yml::key("method") << "umap";
    if (spec.projection) {
        if (!spec.projection->metric.empty()) {
            projection.append_child() << c4::yml::key("metric") << spec.projection->metric;
        }
        if (spec.projection->neighbors) {
            projection.append_child() << c4::yml::key("neighbors") << *spec.projection->neighbors;
        }
        if (spec.projection->min_dist) {
            projection.append_child() << c4::yml::key("min-dist") << *spec.projection->min_dist;
        }
    }
}

void EncodeDashboardSpec(c4::yml::NodeRef out, const DashboardSpec& spec) {
    out |= c4::yml::MAP;
    if (spec.row) out.append_child() << c4::yml::key("row") << *spec.row;
    if (spec.column) out.append_child() << c4::yml::key("column") << *spec.column;
    out.append_child() << c4::yml::key("width") << spec.width;
    out.append_child() << c4::yml::key("height") << spec.height;
}

struct VisualizeSnapshotFile {
    std::string content;
    c4::yml::Tree tree;
    std::vector<VisualizeSnapshotTest> tests;
};
static std::unordered_map<std::string, VisualizeSnapshotFile> TEST_FILES;

void VisualizeSnapshotTest::LoadTests(const std::filesystem::path& snapshots_dir) {
    if (!TEST_FILES.empty()) return;
    std::cout << "Loading visualize tests at: " << snapshots_dir << std::endl;

    for (auto& p : std::filesystem::directory_iterator(snapshots_dir)) {
        auto filename = p.path().filename().string();
        if (p.path().extension().string() != ".yaml") continue;
        if (filename.find(".tpl.") != std::string::npos) continue;

        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[ SETUP    ] failed to read test file: " << filename << std::endl;
            continue;
        }
        std::stringstream buf;
        buf << in.rdbuf();
        std::string content = buf.str();

        VisualizeSnapshotFile file;
        file.content = std::move(content);
        c4::yml::parse_in_arena(c4::to_csubstr(file.content), &file.tree);

        auto root = file.tree.rootref();
        if (!root.has_child("visualize-snapshots")) {
            std::cout << "[ SETUP    ] " << filename << ": no visualize-snapshots key" << std::endl;
            continue;
        }
        auto snapshots = root["visualize-snapshots"];
        for (auto test_node : snapshots.children()) {
            file.tests.emplace_back();
            auto& test = file.tests.back();
            if (test_node.has_child("name")) {
                c4::csubstr v = test_node["name"].val();
                test.name = v.str ? std::string(v.str, v.len) : std::string();
            }
            if (test_node.has_child("catalog") && test_node["catalog"].has_child("script") &&
                test_node["catalog"]["script"].has_child("input")) {
                c4::csubstr v = test_node["catalog"]["script"]["input"].val();
                if (v.str) {
                    std::string_view trimmed = trim_view(std::string_view{v.str, v.len}, is_no_space);
                    test.catalog_input.assign(trimmed.data(), trimmed.size());
                }
            }
            if (test_node.has_child("script") && test_node["script"].has_child("input")) {
                c4::csubstr v = test_node["script"]["input"].val();
                if (v.str) {
                    std::string_view trimmed = trim_view(std::string_view{v.str, v.len}, is_no_space);
                    test.script_input.assign(trimmed.data(), trimmed.size());
                }
            }
            test.tree = &file.tree;
            test.node_id = test_node.id();
        }

        std::cout << "[ SETUP    ] " << filename << ": " << file.tests.size() << " tests" << std::endl;
        auto it = TEST_FILES.insert({filename, std::move(file)}).first;
        for (auto& t : it->second.tests) {
            t.tree = &it->second.tree;
        }
    }
}

std::vector<const VisualizeSnapshotTest*> VisualizeSnapshotTest::GetTests(std::string_view filename) {
    if (TEST_FILES.empty()) {
        auto root = GetRunfilesSnapshotRoot();
        LoadTests((root.empty() ? std::filesystem::path(".") : root) / "snapshots" / "visualize");
    }
    std::string name{filename};
    auto iter = TEST_FILES.find(name);
    if (iter == TEST_FILES.end()) {
        return {};
    }
    std::vector<const VisualizeSnapshotTest*> tests;
    for (auto& test : iter->second.tests) {
        tests.emplace_back(&test);
    }
    return tests;
}

void operator<<(std::ostream& out, const VisualizeSnapshotTest& p) { out << p.name; }

}  // namespace dashql::testing
