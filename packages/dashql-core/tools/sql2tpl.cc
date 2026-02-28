#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "gflags/gflags.h"

DEFINE_string(source_dir, "", "Source directory");
DEFINE_string(output_file, "", "Output file");

static std::string yaml_escape_name(const std::string& name) {
    // Quote if name contains YAML special characters
    bool need_quote = false;
    for (char c : name) {
        if (c == ':' || c == '#' || c == '\n' || c == '"' || c == '\'') {
            need_quote = true;
            break;
        }
    }
    if (!need_quote) return name;
    std::string out = "'";
    for (char c : name) {
        if (c == '\'') out += "''";
        else out += c;
    }
    out += '\'';
    return out;
}

static void emit_literal_block(std::ostream& out, const std::string& content) {
    // Literal block scalar: each line indented with 6 spaces
    const char* p = content.data();
    const char* end = p + content.size();
    while (p < end) {
        out << "      ";
        while (p < end && *p != '\n') out << *p++;
        if (p < end) out << '\n', ++p;
        else out << '\n';
    }
}

int main(int argc, char* argv[]) {
    gflags::SetUsageMessage("Usage: ./sql2tpl --source_dir <dir> --output_file <file>");
    gflags::ParseCommandLineFlags(&argc, &argv, false);

    if (!std::filesystem::exists(FLAGS_source_dir)) {
        std::cout << "Invalid source directory: " << FLAGS_source_dir << std::endl;
        return -1;
    }
    auto source_dir = std::filesystem::path{FLAGS_source_dir};

    if (FLAGS_output_file == "") {
        std::cout << "Invalid output file" << std::endl;
        return -1;
    }

    // Collect .sql files and sort for deterministic output
    std::vector<std::filesystem::path> sql_files;
    for (auto& p : std::filesystem::directory_iterator(source_dir)) {
        if (p.path().extension() != ".sql") continue;
        sql_files.push_back(p.path());
    }
    std::sort(sql_files.begin(), sql_files.end());

    std::ofstream out{FLAGS_output_file};
    out << "parser-snapshots:\n";

    for (const auto& path : sql_files) {
        std::string snapshot_name = path.stem().string();

        std::ifstream in(path, std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << path.filename().string() << "] failed to read file" << std::endl;
            continue;
        }
        std::stringstream buf;
        buf << in.rdbuf();
        std::string content = buf.str();

        // Normalize line endings to \n and trim trailing newlines
        if (!content.empty()) {
            size_t i = 0;
            for (size_t j = 0; j < content.size(); ++j) {
                if (content[j] != '\r') content[i++] = content[j];
                else if (j + 1 < content.size() && content[j + 1] == '\n') { content[i++] = '\n'; ++j; }
                else content[i++] = '\n';
            }
            content.resize(i);
            while (!content.empty() && content.back() == '\n') content.pop_back();
        }

        out << "  - name: " << yaml_escape_name(snapshot_name) << "\n";
        out << "    input: |\n";
        emit_literal_block(out, content);
    }

    return 0;
}
