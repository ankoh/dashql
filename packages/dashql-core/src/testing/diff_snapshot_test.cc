#include "dashql/testing/diff_snapshot_test.h"

#include <fstream>
#include <iostream>
#include <sstream>
#include <unordered_map>

#include "c4/yml/std/std.hpp"
#include "dashql/buffers/index_generated.h"
#include "dashql/testing/runfiles_dir.h"
#include "dashql/testing/yaml_tests.h"
#include "dashql/utils/string_trimming.h"
#include "ryml.hpp"

namespace dashql::testing {

void operator<<(std::ostream& out, const DiffSnapshotTest& p) { out << p.name; }

void DiffSnapshotTest::EncodeDiff(c4::yml::NodeRef root, const std::vector<ScriptDiff::DiffOp>& ops,
                                  std::string_view source_text, std::string_view target_text) {
    auto ops_node = root.append_child();
    ops_node << c4::yml::key("ops");
    ops_node |= c4::yml::SEQ;

    using OpCode = buffers::diff::ScriptDiffOpCode;

    for (auto& op : ops) {
        auto op_node = ops_node.append_child();
        op_node.set_type(c4::yml::MAP);

        op_node.append_child() << c4::yml::key("code")
                               << std::string(buffers::diff::EnumNameScriptDiffOpCode(op.code));

        // The statement indices are the authoritative mapping (presence, not the spans).
        if (op.source_statement) {
            op_node.append_child() << c4::yml::key("source-statement") << *op.source_statement;
        }
        if (op.target_statement) {
            op_node.append_child() << c4::yml::key("target-statement") << *op.target_statement;
        }

        // Emit only the span(s) that mark the *position of the change* — the whole-statement span is
        // noise. Each is encoded as resolved text (like every other snapshot), never a raw offset range.
        switch (op.code) {
            case OpCode::UPDATE: {
                // The changed sub-ranges within the new statement ARE the diff position; the
                // enclosing statement span is uninteresting, so we omit it entirely.
                auto changes_node = op_node.append_child();
                changes_node << c4::yml::key("target-changes");
                changes_node |= c4::yml::SEQ;
                for (auto& change : op.target_changes) {
                    auto change_node = changes_node.append_child();
                    change_node.set_type(c4::yml::MAP);
                    EncodeLocationText(change_node, change, target_text, "text");
                }
                break;
            }
            case OpCode::INSERT:
                // The whole inserted statement is the change (only exists in the new text).
                EncodeLocationText(op_node, op.target_span, target_text, "target-span");
                break;
            case OpCode::DELETE:
                // The whole removed statement is the change (only exists in the old text).
                EncodeLocationText(op_node, op.source_span, source_text, "source-span");
                break;
            case OpCode::MOVE:
            case OpCode::KEEP:
                // Content is unchanged; show where the statement sits in the new text. For KEEP this
                // also guards span resolution (e.g. a statement shifted by a leading comment).
                EncodeLocationText(op_node, op.target_span, target_text, "target-span");
                break;
        }
    }
}

struct DiffSnapshotFile {
    std::string content;
    c4::yml::Tree tree;
    std::vector<DiffSnapshotTest> tests;
};

static std::unordered_map<std::string, DiffSnapshotFile> TEST_FILES;

static std::string ReadTrimmedText(c4::yml::ConstNodeRef node) {
    if (!node.has_val()) return {};
    c4::csubstr v = node.val();
    if (!v.str) return {};
    std::string_view trimmed =
        trim_view_right(trim_view_left(std::string_view{v.str, v.len}, is_no_space), is_no_newline);
    return std::string(trimmed);
}

void DiffSnapshotTest::LoadTests(const std::filesystem::path& snapshots_dir) {
    if (!TEST_FILES.empty()) return;
    std::cout << "Loading diff snapshot tests at: " << snapshots_dir << std::endl;

    for (auto& p : std::filesystem::directory_iterator(snapshots_dir)) {
        auto filename = p.path().filename().string();
        if (p.path().extension().string() != ".yaml") continue;

        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[ SETUP    ] failed to read test file: " << filename << std::endl;
            continue;
        }
        std::stringstream buf;
        buf << in.rdbuf();
        std::string content = buf.str();

        DiffSnapshotFile file;
        file.content = std::move(content);
        c4::yml::parse_in_arena(c4::to_csubstr(file.content), &file.tree);

        auto root = file.tree.rootref();
        if (!root.has_child("diff-snapshots")) {
            std::cout << "[ SETUP    ] " << filename << ": no diff-snapshots key" << std::endl;
            continue;
        }
        auto snapshots = root["diff-snapshots"];
        for (auto child : snapshots.children()) {
            DiffSnapshotTest t;
            if (child.has_child("name")) {
                c4::csubstr v = child["name"].val();
                t.name = v.str ? std::string(v.str, v.len) : std::string();
            }
            if (child.has_child("source")) t.source = ReadTrimmedText(child["source"]);
            if (child.has_child("target")) t.target = ReadTrimmedText(child["target"]);
            if (!child.has_child("expected")) continue;  // skip template-only entries
            t.node_id = child.id();
            file.tests.push_back(std::move(t));
        }

        std::cout << "[ SETUP    ] " << filename << ": " << file.tests.size() << " tests" << std::endl;
        auto it = TEST_FILES.insert({filename, std::move(file)}).first;
        for (auto& t : it->second.tests) t.tree = &it->second.tree;
    }
}

std::vector<const DiffSnapshotTest*> DiffSnapshotTest::GetTests(std::string_view filename) {
    if (TEST_FILES.empty()) {
        auto root = GetRunfilesSnapshotRoot();
        LoadTests((root.empty() ? std::filesystem::path(".") : root) / "snapshots" / "diff");
    }
    std::string name{filename};
    auto it = TEST_FILES.find(name);
    if (it == TEST_FILES.end()) return {};
    std::vector<const DiffSnapshotTest*> out;
    for (auto& t : it->second.tests) out.push_back(&t);
    return out;
}

}  // namespace dashql::testing
