#include "dashql/shell/arrow_renderer.h"

#include <algorithm>
#include <cctype>
#include <iterator>
#include <limits>
#include <memory>
#include <optional>
#include <string_view>
#include <utility>
#include <vector>

#include "arrow/array/array_base.h"
#include "arrow/buffer.h"
#include "arrow/ipc/reader.h"
#include "arrow/io/memory.h"
#include "arrow/record_batch.h"
#include "arrow/scalar.h"
#include "arrow/type.h"
#include "utf8proc/utf8proc_wrapper.hpp"

namespace dashql::shell {
namespace {

enum class Alignment { kLeft, kRight };

constexpr size_t CELL_PADDING = 2;
constexpr size_t MIN_CONTENT_WIDTH = 1;
constexpr size_t MAX_ROW_HEIGHT = 20;
constexpr std::string_view TRUNCATION_MARKER = "...";

struct Cell {
    std::string text;
    Alignment alignment = Alignment::kLeft;
};

struct Table {
    std::vector<std::string> headers;
    std::vector<Alignment> alignments;
    std::vector<std::vector<Cell>> rows;
};

size_t DisplayWidth(std::string_view text) {
    if (!utf8::Utf8Proc::IsValid(text)) {
        return text.size();
    }
    size_t width = 0;
    for (size_t offset = 0; offset < text.size();) {
        width += utf8::Utf8Proc::RenderWidth(text, offset);
        const auto next = utf8::Utf8Proc::NextGraphemeCluster(text, offset);
        if (next <= offset) {
            ++offset;
        } else {
            offset = next;
        }
    }
    return width;
}

std::string EscapeCellText(std::string_view text) {
    std::string output;
    output.reserve(text.size());
    constexpr char HEX[] = "0123456789abcdef";
    for (size_t i = 0; i < text.size(); ++i) {
        const auto value = static_cast<uint8_t>(text[i]);
        if (value == '\n') {
            output.push_back('\n');
        } else if (value == '\r') {
            if (i + 1 >= text.size() || text[i + 1] != '\n') {
                output.push_back('\n');
            }
        } else if (value == '\t') {
            output.append("    ");
        } else if (value < 0x20 || value == 0x7f) {
            output.append("\\x");
            output.push_back(HEX[value >> 4]);
            output.push_back(HEX[value & 0x0f]);
        } else {
            output.push_back(text[i]);
        }
    }
    return output;
}

bool IsRightAligned(arrow::Type::type type) {
    switch (type) {
        case arrow::Type::BOOL:
        case arrow::Type::INT8:
        case arrow::Type::INT16:
        case arrow::Type::INT32:
        case arrow::Type::INT64:
        case arrow::Type::UINT8:
        case arrow::Type::UINT16:
        case arrow::Type::UINT32:
        case arrow::Type::UINT64:
        case arrow::Type::HALF_FLOAT:
        case arrow::Type::FLOAT:
        case arrow::Type::DOUBLE:
        case arrow::Type::DECIMAL32:
        case arrow::Type::DECIMAL64:
        case arrow::Type::DECIMAL128:
        case arrow::Type::DECIMAL256:
            return true;
        default:
            return false;
    }
}

arrow::Result<std::string> FormatValue(const arrow::Array& array, int64_t row) {
    if (array.IsNull(row)) {
        return std::string{};
    }
    ARROW_ASSIGN_OR_RAISE(auto scalar, array.GetScalar(row));
    return EscapeCellText(scalar->ToString());
}

Table CreateTable(const std::shared_ptr<arrow::Schema>& schema) {
    Table table;
    table.headers.reserve(schema->num_fields());
    table.alignments.reserve(schema->num_fields());
    for (const auto& field : schema->fields()) {
        table.headers.push_back(EscapeCellText(field->name()));
        table.alignments.push_back(IsRightAligned(field->type()->id()) ? Alignment::kRight : Alignment::kLeft);
    }
    return table;
}

arrow::Status AppendBatch(Table& table, const arrow::RecordBatch& batch) {
    for (int64_t row = 0; row < batch.num_rows(); ++row) {
        std::vector<Cell> cells;
        cells.reserve(batch.num_columns());
        for (int column = 0; column < batch.num_columns(); ++column) {
            ARROW_ASSIGN_OR_RAISE(auto text, FormatValue(*batch.column(column), row));
            cells.push_back(Cell{std::move(text), table.alignments[column]});
        }
        table.rows.push_back(std::move(cells));
    }
    return arrow::Status::OK();
}

arrow::Result<Table> ReadIPC(std::span<const uint8_t> data) {
    if (data.empty()) {
        return arrow::Status::Invalid("Arrow IPC buffer is empty");
    }
    auto buffer = std::make_shared<arrow::Buffer>(data.data(), static_cast<int64_t>(data.size()));
    auto input = std::make_shared<arrow::io::BufferReader>(buffer);
    auto file_reader = arrow::ipc::RecordBatchFileReader::Open(input);
    if (file_reader.ok()) {
        auto reader = std::move(file_reader).ValueUnsafe();
        auto table = CreateTable(reader->schema());
        for (int batch_index = 0; batch_index < reader->num_record_batches(); ++batch_index) {
            ARROW_ASSIGN_OR_RAISE(auto batch, reader->ReadRecordBatch(batch_index));
            ARROW_RETURN_NOT_OK(AppendBatch(table, *batch));
        }
        return table;
    }

    input = std::make_shared<arrow::io::BufferReader>(std::move(buffer));
    ARROW_ASSIGN_OR_RAISE(auto reader, arrow::ipc::RecordBatchStreamReader::Open(input));
    auto table = CreateTable(reader->schema());
    for (;;) {
        ARROW_ASSIGN_OR_RAISE(auto batch, reader->Next());
        if (!batch) break;
        ARROW_RETURN_NOT_OK(AppendBatch(table, *batch));
    }
    return table;
}

struct Grapheme {
    size_t begin;
    size_t end;
    size_t width;
};

std::vector<Grapheme> Graphemes(std::string_view text) {
    std::vector<Grapheme> graphemes;
    const bool valid_utf8 = utf8::Utf8Proc::IsValid(text);
    for (size_t offset = 0; offset < text.size();) {
        size_t next = offset + 1;
        if (valid_utf8) {
            next = utf8::Utf8Proc::NextGraphemeCluster(text, offset);
            if (next <= offset) next = offset + 1;
        }
        graphemes.push_back({offset, next, DisplayWidth(text.substr(offset, next - offset))});
        offset = next;
    }
    return graphemes;
}

std::string MarkTruncated(std::string_view text, size_t width) {
    const auto marker_width = std::min(width, TRUNCATION_MARKER.size());
    const auto content_width = width - marker_width;
    size_t end = 0;
    size_t rendered = 0;
    for (const auto& grapheme : Graphemes(text)) {
        if (rendered + grapheme.width > content_width) break;
        rendered += grapheme.width;
        end = grapheme.end;
    }
    std::string output{text.substr(0, end)};
    output.append(TRUNCATION_MARKER.substr(0, marker_width));
    return output;
}

std::vector<std::string> WrapLine(std::string_view text, size_t width) {
    width = std::max<size_t>(width, 1);
    if (text.empty()) return {std::string{}};

    const auto graphemes = Graphemes(text);
    std::vector<std::string> lines;
    for (size_t begin = 0; begin < graphemes.size();) {
        size_t end = begin;
        size_t rendered = 0;
        std::optional<size_t> whitespace;
        while (end < graphemes.size() && (rendered == 0 || rendered + graphemes[end].width <= width)) {
            rendered += graphemes[end].width;
            if (graphemes[end].end - graphemes[end].begin == 1 &&
                std::isspace(static_cast<unsigned char>(text[graphemes[end].begin]))) {
                whitespace = end;
            }
            ++end;
        }
        if (end < graphemes.size() && whitespace.has_value() && *whitespace >= begin) {
            end = *whitespace + 1;
        }
        size_t content_end = end;
        while (content_end > begin && graphemes[content_end - 1].end - graphemes[content_end - 1].begin == 1 &&
               std::isspace(static_cast<unsigned char>(text[graphemes[content_end - 1].begin]))) {
            --content_end;
        }
        const auto byte_begin = graphemes[begin].begin;
        const auto byte_end = content_end > begin ? graphemes[content_end - 1].end : byte_begin;
        lines.emplace_back(text.substr(byte_begin, byte_end - byte_begin));
        begin = end;
    }
    return lines;
}

std::vector<std::string> WrapText(std::string_view text, size_t width) {
    std::vector<std::string> lines;
    size_t begin = 0;
    while (begin <= text.size()) {
        const auto end = text.find('\n', begin);
        auto wrapped = WrapLine(text.substr(begin, end - begin), width);
        lines.insert(lines.end(), std::make_move_iterator(wrapped.begin()), std::make_move_iterator(wrapped.end()));
        if (end == std::string_view::npos) break;
        begin = end + 1;
    }
    return lines;
}

size_t FrameWidth(size_t column_count) {
    return column_count == 0 ? 0 : (CELL_PADDING + 1) * column_count + 1;
}

size_t VisibleColumnCount(size_t column_count, size_t terminal_columns) {
    while (column_count > 1 && FrameWidth(column_count) + column_count * MIN_CONTENT_WIDTH > terminal_columns) {
        --column_count;
    }
    return column_count;
}

std::vector<size_t> ResolveColumnWidths(const Table& table, size_t terminal_columns) {
    const size_t column_count = VisibleColumnCount(table.headers.size(), terminal_columns);
    std::vector<size_t> widths(column_count, 1);
    for (size_t column = 0; column < column_count; ++column) {
        widths[column] = std::max<size_t>(1, DisplayWidth(table.headers[column]));
    }
    for (const auto& row : table.rows) {
        for (size_t column = 0; column < std::min(row.size(), column_count); ++column) {
            for (const auto& line : WrapText(row[column].text, std::numeric_limits<size_t>::max())) {
                widths[column] = std::max(widths[column], DisplayWidth(line));
            }
        }
    }

    if (column_count == 0) {
        return widths;
    }
    const size_t frame_width = FrameWidth(column_count);
    const size_t available = terminal_columns > frame_width ? terminal_columns - frame_width : column_count;
    if (available < column_count) {
        return std::vector<size_t>(column_count, MIN_CONTENT_WIDTH);
    }
    size_t total = 0;
    for (const auto width : widths) {
        total += width;
    }
    std::vector<bool> fixed(column_count, false);
    while (total > available) {
        size_t remaining_width = available;
        size_t remaining_columns = 0;
        for (size_t column = 0; column < column_count; ++column) {
            if (fixed[column]) {
                remaining_width = remaining_width > widths[column] ? remaining_width - widths[column] : 0;
            } else {
                ++remaining_columns;
            }
        }
        if (remaining_columns == 0) break;
        const auto share = std::max(MIN_CONTENT_WIDTH, remaining_width / remaining_columns);
        bool found_small = false;
        for (size_t column = 0; column < column_count; ++column) {
            if (!fixed[column] && widths[column] <= share) {
                fixed[column] = true;
                found_small = true;
            }
        }
        if (found_small) continue;

        const auto base = std::max(MIN_CONTENT_WIDTH, remaining_width / remaining_columns);
        auto excess = remaining_width > base * remaining_columns ? remaining_width - base * remaining_columns : 0;
        total = 0;
        for (size_t column = 0; column < column_count; ++column) {
            if (!fixed[column]) {
                widths[column] = base + (excess > 0 ? 1 : 0);
                if (excess > 0) --excess;
            }
            total += widths[column];
        }
        break;
    }
    return widths;
}

void AppendRule(std::string& output,
                std::string_view left,
                std::string_view middle,
                std::string_view right,
                std::string_view fill,
                const std::vector<size_t>& widths) {
    output.append(left);
    for (size_t column = 0; column < widths.size(); ++column) {
        if (column != 0) {
            output.append(middle);
        }
        for (size_t i = 0; i < widths[column] + 2; ++i) {
            output.append(fill);
        }
    }
    output.append(right);
    output.push_back('\n');
}

void AppendCell(std::string& output, std::string_view text, size_t width, Alignment alignment) {
    const size_t rendered = DisplayWidth(text);
    const size_t padding = rendered < width ? width - rendered : 0;
    if (alignment == Alignment::kRight) {
        output.append(padding, ' ');
    }
    output.append(text);
    if (alignment == Alignment::kLeft) {
        output.append(padding, ' ');
    }
}

void AppendRow(std::string& output,
               const std::vector<Cell>& cells,
               const std::vector<size_t>& widths,
               std::string_view separator) {
    std::vector<std::vector<std::string>> wrapped;
    wrapped.reserve(widths.size());
    size_t row_height = 1;
    for (size_t column = 0; column < widths.size(); ++column) {
        const std::string_view text = column < cells.size() ? std::string_view{cells[column].text} : std::string_view{};
        wrapped.push_back(WrapText(text, widths[column]));
        if (wrapped.back().size() > MAX_ROW_HEIGHT) {
            wrapped.back().resize(MAX_ROW_HEIGHT);
            wrapped.back().back() = MarkTruncated(wrapped.back().back(), widths[column]);
        }
        row_height = std::max(row_height, wrapped.back().size());
    }

    for (size_t line = 0; line < row_height; ++line) {
        output.append("│ ");
        for (size_t column = 0; column < widths.size(); ++column) {
            if (column != 0) {
                output.push_back(' ');
                output.append(separator);
                output.push_back(' ');
            }
            const std::string_view text = line < wrapped[column].size() ? std::string_view{wrapped[column][line]}
                                                                        : std::string_view{};
            const auto alignment = column < cells.size() ? cells[column].alignment : Alignment::kLeft;
            AppendCell(output, text, widths[column], alignment);
        }
        output.append(" │\n");
    }
}

std::string RenderTable(const Table& table, size_t terminal_columns) {
    if (table.headers.empty()) {
        return {};
    }
    const auto widths = ResolveColumnWidths(table, terminal_columns);
    std::string output;
    AppendRule(output, "╭", "┬", "╮", "─", widths);

    std::vector<Cell> headers;
    headers.reserve(table.headers.size());
    for (size_t column = 0; column < widths.size(); ++column) {
        auto header = table.headers[column];
        if (column + 1 == widths.size() && widths.size() < table.headers.size()) {
            header = MarkTruncated(header, widths[column]);
        }
        headers.push_back(Cell{std::move(header), Alignment::kLeft});
    }
    AppendRow(output, headers, widths, "│");
    AppendRule(output, "╞", "╪", "╡", "═", widths);
    for (const auto& row : table.rows) {
        AppendRow(output, row, widths, "│");
    }
    AppendRule(output, "╰", "┴", "╯", "─", widths);
    if (!output.empty()) {
        output.pop_back();
    }
    return output;
}

}  // namespace

ArrowRenderer::ArrowRenderer(uint32_t terminal_columns) : terminal_columns_{std::max<uint32_t>(terminal_columns, 1)} {}

void ArrowRenderer::Resize(uint32_t terminal_columns) {
    terminal_columns_ = std::max<uint32_t>(terminal_columns, 1);
}

arrow::Result<std::string> ArrowRenderer::RenderIPC(std::span<const uint8_t> data) const {
    ARROW_ASSIGN_OR_RAISE(auto table, ReadIPC(data));
    return RenderTable(table, terminal_columns_);
}

}  // namespace dashql::shell
