#include "dashql/shell/api.h"
#include "dashql/shell/arrow_renderer.h"
#include "dashql/shell/shell_session.h"

#include <memory>
#include <string>
#include <vector>

#include "arrow/api.h"
#include "arrow/io/memory.h"
#include "arrow/ipc/writer.h"
#include "dashql/catalog.h"
#include "gtest/gtest.h"
#include "utf8proc/utf8proc_wrapper.hpp"

namespace dashql::shell {
namespace {

std::shared_ptr<arrow::Buffer> WriteIPC(const std::shared_ptr<arrow::RecordBatch>& batch) {
    auto output = arrow::io::BufferOutputStream::Create().ValueOrDie();
    auto writer = arrow::ipc::MakeFileWriter(output, batch->schema()).ValueOrDie();
    EXPECT_TRUE(writer->WriteRecordBatch(*batch).ok());
    EXPECT_TRUE(writer->Close().ok());
    return output->Finish().ValueOrDie();
}

std::shared_ptr<arrow::RecordBatch> MakeBatch() {
    arrow::StringBuilder names;
    EXPECT_TRUE(names.Append("alpha").ok());
    EXPECT_TRUE(names.Append("界").ok());
    EXPECT_TRUE(names.AppendNull().ok());

    arrow::Int32Builder values;
    EXPECT_TRUE(values.Append(1).ok());
    EXPECT_TRUE(values.Append(20).ok());
    EXPECT_TRUE(values.Append(300).ok());

    auto name_array = names.Finish().ValueOrDie();
    auto value_array = values.Finish().ValueOrDie();
    auto schema = arrow::schema({arrow::field("name", arrow::utf8()), arrow::field("value", arrow::int32())});
    return arrow::RecordBatch::Make(std::move(schema), 3, {std::move(name_array), std::move(value_array)});
}

TEST(ArrowRendererTest, RendersArrowIPC) {
    const auto ipc = WriteIPC(MakeBatch());
    ArrowRenderer renderer{80};
    auto output = renderer.RenderIPC(std::span<const uint8_t>{ipc->data(), static_cast<size_t>(ipc->size())});
    ASSERT_TRUE(output.ok()) << output.status().ToString();
    EXPECT_EQ(*output,
              "┌───────┬───────┐\n"
              "│ name  │ value │\n"
              "╞═══════╪═══════╡\n"
              "│ alpha ┆     1 │\n"
              "│ 界    ┆    20 │\n"
              "│       ┆   300 │\n"
              "└───────┴───────┘");
}

TEST(ArrowRendererTest, ConstrainsOutputToTerminalWidth) {
    const auto ipc = WriteIPC(MakeBatch());
    ArrowRenderer renderer{15};
    auto output = renderer.RenderIPC(std::span<const uint8_t>{ipc->data(), static_cast<size_t>(ipc->size())});
    ASSERT_TRUE(output.ok()) << output.status().ToString();
    size_t line_start = 0;
    while (line_start <= output->size()) {
        const auto line_end = output->find('\n', line_start);
        const auto line = output->substr(line_start, line_end - line_start);
        EXPECT_LE(utf8::Utf8Proc::RenderWidth(line), 15) << line;
        if (line_end == std::string::npos) {
            break;
        }
        line_start = line_end + 1;
    }
}

TEST(ArrowRendererTest, EscapesTerminalControlCharacters) {
    arrow::StringBuilder values;
    EXPECT_TRUE(values.Append("safe\x1b[31mred").ok());
    auto value_array = values.Finish().ValueOrDie();
    auto schema = arrow::schema({arrow::field("text", arrow::utf8())});
    const auto batch = arrow::RecordBatch::Make(std::move(schema), 1, {std::move(value_array)});
    const auto ipc = WriteIPC(batch);

    ArrowRenderer renderer{80};
    auto output = renderer.RenderIPC(std::span<const uint8_t>{ipc->data(), static_cast<size_t>(ipc->size())});
    ASSERT_TRUE(output.ok()) << output.status().ToString();
    EXPECT_EQ(output->find('\x1b'), std::string::npos);
    EXPECT_NE(output->find("safe\\x1b[31mred"), std::string::npos);
}

uint32_t ReadU32(std::string_view data, size_t offset) {
    uint32_t value = 0;
    for (size_t i = 0; i < sizeof(value); ++i) {
        value |= static_cast<uint32_t>(static_cast<uint8_t>(data[offset + i])) << (i * 8);
    }
    return value;
}

uint64_t ReadU64(std::string_view data, size_t offset) {
    return static_cast<uint64_t>(ReadU32(data, offset)) |
           (static_cast<uint64_t>(ReadU32(data, offset + sizeof(uint32_t))) << 32);
}

TEST(ShellSessionTest, SuspendsAndResumesQueryCoroutine) {
    Catalog catalog;
    ShellSession session{catalog, 80};
    const auto pending = session.StartQuery("SELECT 42");
    ASSERT_EQ(pending.status, ShellStatus::kPending);
    ASSERT_GE(pending.data.size(), 16);
    EXPECT_EQ(ReadU32(pending.data, 0), 1);
    EXPECT_EQ(ReadU32(pending.data, 4), static_cast<uint32_t>(EffectType::kExecuteQuery));
    EXPECT_EQ(pending.data.substr(16), "SELECT 42");

    const auto ipc = WriteIPC(MakeBatch());
    const auto complete = session.CompleteEffect(
        ReadU64(pending.data, 8),
        EffectCompletionStatus::kSuccess,
        std::span<const uint8_t>{ipc->data(), static_cast<size_t>(ipc->size())});
    ASSERT_EQ(complete.status, ShellStatus::kOk);
    EXPECT_NE(complete.data.find("alpha"), std::string::npos);
}

TEST(ShellSessionTest, RejectsConcurrentQueriesAndStaleCompletions) {
    Catalog catalog;
    ShellSession session{catalog, 80};
    const auto pending = session.StartQuery("SELECT 1");
    ASSERT_EQ(pending.status, ShellStatus::kPending);
    const auto effect_id = ReadU64(pending.data, 8);

    EXPECT_EQ(session.StartQuery("SELECT 2").status, ShellStatus::kBusy);
    EXPECT_EQ(session.CancelEffect(effect_id).data, "Cancelled");
    EXPECT_EQ(session.CancelEffect(effect_id).status, ShellStatus::kStaleEffect);
}

TEST(ShellSessionTest, ConvertsQueryErrorsToOutput) {
    Catalog catalog;
    ShellSession session{catalog, 80};
    const auto pending = session.StartQuery("broken");
    ASSERT_EQ(pending.status, ShellStatus::kPending);
    const std::string error = "syntax error";
    const auto complete = session.CompleteEffect(
        ReadU64(pending.data, 8),
        EffectCompletionStatus::kError,
        std::span<const uint8_t>{reinterpret_cast<const uint8_t*>(error.data()), error.size()});
    EXPECT_EQ(complete.status, ShellStatus::kOk);
    EXPECT_EQ(complete.data, error);
}

}  // namespace
}  // namespace dashql::shell
