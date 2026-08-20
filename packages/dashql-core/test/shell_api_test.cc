#include <string>
#include <string_view>
#include <vector>

#include "dashql/catalog.h"
#include "dashql/script.h"
#include "dashql/shell/api.h"
#include "dashql/shell/vt100.h"
#include "gtest/gtest.h"

namespace {

std::string_view TerminalData(const DashQLShellTerminalResult& result) {
    return {reinterpret_cast<const char*>(result.data_ptr), result.data_length};
}

std::string_view PromptText(const DashQLShellPromptResult& result) {
    return {reinterpret_cast<const char*>(result.text_ptr), result.text_length};
}

size_t CountOccurrences(std::string_view text, std::string_view needle) {
    size_t count = 0;
    for (size_t offset = 0; (offset = text.find(needle, offset)) != std::string_view::npos; offset += needle.size()) {
        ++count;
    }
    return count;
}

uint32_t ConsumeTerminal(DashQLShell* shell, uint32_t key, DashQLShellTerminalResult* result,
                         std::string_view text = {}) {
    return dashql_shell_terminal_consume(shell, key, reinterpret_cast<const uint8_t*>(text.data()), text.size(),
                                         result);
}

uint64_t ReadU64(const uint8_t* data) {
    uint64_t value = 0;
    for (size_t i = 0; i < sizeof(value); ++i) value |= static_cast<uint64_t>(data[i]) << (i * 8);
    return value;
}

uint32_t CompleteQuery(DashQLShell* shell, std::string_view query, uint32_t completion_status) {
    DashQLShellResult result{};
    EXPECT_EQ(dashql_shell_start_query(shell, reinterpret_cast<const uint8_t*>(query.data()), query.size(), &result),
              DASHQL_SHELL_PENDING);
    if (result.status != DASHQL_SHELL_PENDING || result.data_length < 16) {
        dashql_shell_result_destroy(&result);
        return DASHQL_SHELL_INTERNAL_ERROR;
    }
    const auto effect_id = ReadU64(result.data_ptr + 8);
    dashql_shell_result_destroy(&result);
    const auto status =
        dashql_shell_complete_effect(shell, static_cast<uint32_t>(effect_id), static_cast<uint32_t>(effect_id >> 32),
                                     completion_status, nullptr, 0, &result);
    dashql_shell_result_destroy(&result);
    return status;
}

std::vector<std::string> CompleteText(DashQLShell* shell, std::string_view query) {
    DashQLShellPromptResult prompt{};
    EXPECT_EQ(dashql_shell_prompt_set(shell, reinterpret_cast<const uint8_t*>(query.data()), query.size(), &prompt),
              DASHQL_SHELL_OK);
    dashql_shell_prompt_result_destroy(&prompt);

    DashQLShellCompletionResult completions{};
    EXPECT_EQ(dashql_shell_prompt_complete(shell, 50, &completions), DASHQL_SHELL_OK);
    std::vector<std::string> output;
    const auto* candidates = static_cast<const DashQLShellCompletionCandidate*>(completions.candidates_ptr);
    for (size_t i = 0; i < completions.count; ++i) {
        output.emplace_back(reinterpret_cast<const char*>(candidates[i].completion_text_ptr),
                            candidates[i].completion_text_length);
    }
    dashql_shell_completion_result_destroy(&completions);
    return output;
}

bool HasCompletion(DashQLShell* shell, std::string_view query, std::string_view expected) {
    const auto completions = CompleteText(shell, query);
    return std::find(completions.begin(), completions.end(), expected) != completions.end();
}

// Select a terminal candidate by its inserted text and leave its rendered hint in `output`.
size_t SelectTerminalCompletion(DashQLShell* shell, std::string_view completion_text,
                                DashQLShellTerminalResult* output) {
    DashQLShellCompletionResult completions{};
    EXPECT_EQ(dashql_shell_prompt_complete(shell, 50, &completions), DASHQL_SHELL_OK);
    const auto* candidates = static_cast<const DashQLShellCompletionCandidate*>(completions.candidates_ptr);
    size_t candidate_index = completions.count;
    for (size_t i = 0; i < completions.count; ++i) {
        if (std::string_view{reinterpret_cast<const char*>(candidates[i].completion_text_ptr),
                             candidates[i].completion_text_length} == completion_text) {
            candidate_index = i;
            break;
        }
    }
    const auto candidate_count = completions.count;
    EXPECT_LT(candidate_index, candidate_count);
    dashql_shell_completion_result_destroy(&completions);
    if (candidate_index >= candidate_count) return candidate_index;

    for (size_t i = 0; i < candidate_index; ++i) {
        EXPECT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_HISTORY_NEXT, output), DASHQL_SHELL_OK);
        dashql_shell_terminal_result_destroy(output);
    }
    if (candidate_index == 0) {
        EXPECT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_HISTORY_NEXT, output), DASHQL_SHELL_OK);
        dashql_shell_terminal_result_destroy(output);
        EXPECT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_HISTORY_PREVIOUS, output), DASHQL_SHELL_OK);
    }
    return candidate_index;
}

TEST(ShellApiTest, EditsAndSubmitsPrompt) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellPromptResult prompt{};
    const std::string query = "select 1";
    EXPECT_EQ(dashql_shell_prompt_set(shell, reinterpret_cast<const uint8_t*>(query.data()), query.size(), &prompt),
              DASHQL_SHELL_OK);
    EXPECT_EQ((std::string_view{reinterpret_cast<const char*>(prompt.text_ptr), prompt.text_length}), query);
    EXPECT_EQ(prompt.cursor_byte_offset, query.size());
    EXPECT_EQ(prompt.revision_low, 1);
    dashql_shell_prompt_result_destroy(&prompt);

    EXPECT_EQ(dashql_shell_prompt_move_left(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.cursor_byte_offset, query.size() - 1);
    dashql_shell_prompt_result_destroy(&prompt);

    const std::string insertion = "0";
    EXPECT_EQ(dashql_shell_prompt_insert(shell, reinterpret_cast<const uint8_t*>(insertion.data()), insertion.size(),
                                         &prompt),
              DASHQL_SHELL_OK);
    EXPECT_EQ((std::string_view{reinterpret_cast<const char*>(prompt.text_ptr), prompt.text_length}), "select 01");
    dashql_shell_prompt_result_destroy(&prompt);

    DashQLShellResult operation{};
    EXPECT_EQ(dashql_shell_prompt_submit(shell, &operation), DASHQL_SHELL_PENDING);
    ASSERT_GE(operation.data_length, 16u);
    EXPECT_EQ((std::string_view{reinterpret_cast<const char*>(operation.data_ptr + 16), operation.data_length - 16}),
              "select 01");
    dashql_shell_result_destroy(&operation);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, TracksCreatedAndDroppedSessionRelations) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);
    dashql_shell_session_relations_set(shell, true);

    EXPECT_EQ(CompleteQuery(shell, "CREATE TABLE orders (order_id BIGINT, amount DOUBLE)", DASHQL_SHELL_EFFECT_SUCCESS),
              DASHQL_SHELL_ARROW_ERROR);
    EXPECT_TRUE(HasCompletion(shell, "select * from ord", "orders"));
    EXPECT_TRUE(HasCompletion(shell, "select * from orders where orders.", "order_id"));

    EXPECT_EQ(CompleteQuery(shell, "DROP TABLE orders", DASHQL_SHELL_EFFECT_SUCCESS), DASHQL_SHELL_ARROW_ERROR);
    EXPECT_FALSE(HasCompletion(shell, "select * from ord", "orders"));
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, TracksQualifiedAndDerivedSessionRelations) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);
    dashql_shell_session_relations_set(shell, true);

    EXPECT_EQ(CompleteQuery(shell, "CREATE TABLE source (id BIGINT, amount DOUBLE)", DASHQL_SHELL_EFFECT_SUCCESS),
              DASHQL_SHELL_ARROW_ERROR);
    EXPECT_EQ(CompleteQuery(shell, "CREATE TABLE analytics.totals AS SELECT id, amount AS total FROM source",
                            DASHQL_SHELL_EFFECT_SUCCESS),
              DASHQL_SHELL_ARROW_ERROR);
    EXPECT_EQ(CompleteQuery(shell, "CREATE VIEW report AS SELECT * FROM analytics.totals", DASHQL_SHELL_EFFECT_SUCCESS),
              DASHQL_SHELL_ARROW_ERROR);
    EXPECT_EQ(CompleteQuery(shell, "SELECT id AS copied_id INTO warehouse.reporting.copied FROM source",
                            DASHQL_SHELL_EFFECT_SUCCESS),
              DASHQL_SHELL_ARROW_ERROR);

    EXPECT_TRUE(HasCompletion(shell, "select * from analytics.tot", "totals"));
    EXPECT_TRUE(HasCompletion(shell, "select * from analytics.totals t where t.", "total"));
    EXPECT_TRUE(HasCompletion(shell, "select * from report where report.", "total"));
    EXPECT_TRUE(HasCompletion(shell, "select * from warehouse.reporting.copied where copied.", "copied_id"));
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ReplacesAndSelectivelyDropsSessionRelations) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);
    dashql_shell_session_relations_set(shell, true);

    EXPECT_EQ(CompleteQuery(shell, "CREATE TABLE inventory (old_id BIGINT)", DASHQL_SHELL_EFFECT_SUCCESS),
              DASHQL_SHELL_ARROW_ERROR);
    EXPECT_EQ(
        CompleteQuery(shell, "CREATE TABLE inventory (new_id BIGINT, quantity INTEGER)", DASHQL_SHELL_EFFECT_SUCCESS),
        DASHQL_SHELL_ARROW_ERROR);
    EXPECT_FALSE(HasCompletion(shell, "select * from inventory i where i.old", "old_id"));
    EXPECT_TRUE(HasCompletion(shell, "select * from inventory i where i.new", "new_id"));
    EXPECT_TRUE(HasCompletion(shell, "select * from inventory i where i.quan", "quantity"));

    EXPECT_EQ(CompleteQuery(shell, "CREATE TABLE public.events (public_id BIGINT)", DASHQL_SHELL_EFFECT_SUCCESS),
              DASHQL_SHELL_ARROW_ERROR);
    EXPECT_EQ(CompleteQuery(shell, "CREATE TABLE analytics.events (analytics_id BIGINT)", DASHQL_SHELL_EFFECT_SUCCESS),
              DASHQL_SHELL_ARROW_ERROR);
    EXPECT_EQ(CompleteQuery(shell, "DROP TABLE analytics.events", DASHQL_SHELL_EFFECT_SUCCESS),
              DASHQL_SHELL_ARROW_ERROR);
    EXPECT_TRUE(HasCompletion(shell, "select * from public.events e where e.", "public_id"));
    EXPECT_FALSE(HasCompletion(shell, "select * from analytics.eve", "events"));
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, SessionRelationsOnlyTrackSuccessfulSingleDdlStatements) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);
    dashql_shell_session_relations_set(shell, true);

    EXPECT_EQ(CompleteQuery(shell, "CREATE TABLE failed (id BIGINT)", DASHQL_SHELL_EFFECT_ERROR), DASHQL_SHELL_OK);
    EXPECT_EQ(CompleteQuery(shell, "CREATE TABLE alpha_untracked (id BIGINT); CREATE TABLE beta_untracked (id BIGINT)",
                            DASHQL_SHELL_EFFECT_SUCCESS),
              DASHQL_SHELL_ARROW_ERROR);
    EXPECT_EQ(CompleteQuery(shell, "ATTACH DATABASE source AS source", DASHQL_SHELL_EFFECT_SUCCESS),
              DASHQL_SHELL_ARROW_ERROR);

    EXPECT_FALSE(HasCompletion(shell, "select * from fail", "failed"));
    EXPECT_FALSE(HasCompletion(shell, "select * from alpha_untr", "alpha_untracked"));
    EXPECT_FALSE(HasCompletion(shell, "select * from beta_untr", "beta_untracked"));
    EXPECT_FALSE(HasCompletion(shell, "select * from sou", "source"));
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, SessionRelationTrackingIsOptIn) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    EXPECT_EQ(CompleteQuery(shell, "CREATE TABLE untracked (id BIGINT)", DASHQL_SHELL_EFFECT_SUCCESS),
              DASHQL_SHELL_ARROW_ERROR);
    EXPECT_FALSE(HasCompletion(shell, "select * from untr", "untracked"));
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, StripsTrailingSemicolonWhenSubmittingPrompt) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellPromptResult prompt{};
    const std::string query = "SELECT ';' AS value;  \n";
    ASSERT_EQ(dashql_shell_prompt_set(shell, reinterpret_cast<const uint8_t*>(query.data()), query.size(), &prompt),
              DASHQL_SHELL_OK);
    dashql_shell_prompt_result_destroy(&prompt);

    DashQLShellResult operation{};
    ASSERT_EQ(dashql_shell_prompt_submit(shell, &operation), DASHQL_SHELL_PENDING);
    ASSERT_GE(operation.data_length, 16u);
    EXPECT_EQ((std::string_view{reinterpret_cast<const char*>(operation.data_ptr + 16), operation.data_length - 16}),
              "SELECT ';' AS value");
    dashql_shell_result_destroy(&operation);

    const auto history = dashql_shell_history_export(shell, &operation);
    ASSERT_EQ(history, DASHQL_SHELL_OK);
    const auto history_data =
        std::string_view{reinterpret_cast<const char*>(operation.data_ptr), operation.data_length};
    ASSERT_GE(history_data.size(), sizeof(uint32_t));
    EXPECT_EQ(history_data.substr(sizeof(uint32_t)), query);
    dashql_shell_result_destroy(&operation);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ReturnsCompletionCandidates) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellPromptResult prompt{};
    const std::string query = "sel";
    ASSERT_EQ(dashql_shell_prompt_set(shell, reinterpret_cast<const uint8_t*>(query.data()), query.size(), &prompt),
              DASHQL_SHELL_OK);
    dashql_shell_prompt_result_destroy(&prompt);

    DashQLShellCompletionResult completions{};
    EXPECT_EQ(dashql_shell_prompt_complete(shell, 10, &completions), DASHQL_SHELL_OK);
    EXPECT_GT(completions.count, 0u);
    EXPECT_NE(completions.candidates_ptr, nullptr);
    dashql_shell_completion_result_destroy(&completions);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, DrivesPromptInteractionAndHistory) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellPromptResult prompt{};
    const std::string incomplete = "select 1";
    ASSERT_EQ(
        dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_TEXT, reinterpret_cast<const uint8_t*>(incomplete.data()),
                                    incomplete.size(), &prompt),
        DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.action, DASHQL_SHELL_INPUT_NONE);
    dashql_shell_prompt_result_destroy(&prompt);

    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_ENTER, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.action, DASHQL_SHELL_INPUT_NONE);
    EXPECT_EQ((std::string_view{reinterpret_cast<const char*>(prompt.text_ptr), prompt.text_length}), "select 1\n");
    dashql_shell_prompt_result_destroy(&prompt);

    const std::string terminator = ";";
    ASSERT_EQ(
        dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_TEXT, reinterpret_cast<const uint8_t*>(terminator.data()),
                                    terminator.size(), &prompt),
        DASHQL_SHELL_OK);
    dashql_shell_prompt_result_destroy(&prompt);
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_ENTER, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.action, DASHQL_SHELL_INPUT_SUBMIT);
    dashql_shell_prompt_result_destroy(&prompt);

    DashQLShellResult operation{};
    ASSERT_EQ(dashql_shell_prompt_submit(shell, &operation), DASHQL_SHELL_PENDING);
    dashql_shell_result_destroy(&operation);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, SubmitsSemicolonTerminatedPromptWithLocalParseErrors) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellPromptResult prompt{};
    constexpr std::string_view query = "fooo;";
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_TEXT,
                                          reinterpret_cast<const uint8_t*>(query.data()), query.size(), &prompt),
              DASHQL_SHELL_OK);
    dashql_shell_prompt_result_destroy(&prompt);

    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_ENTER, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.action, DASHQL_SHELL_INPUT_SUBMIT);
    EXPECT_EQ(PromptText(prompt), query);
    dashql_shell_prompt_result_destroy(&prompt);

    DashQLShellResult operation{};
    ASSERT_EQ(dashql_shell_prompt_submit(shell, &operation), DASHQL_SHELL_PENDING);
    ASSERT_GE(operation.data_length, 16u);
    EXPECT_EQ((std::string_view{reinterpret_cast<const char*>(operation.data_ptr + 16), operation.data_length - 16}),
              std::string_view{"fooo"});
    dashql_shell_result_destroy(&operation);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ContinuesPromptWhenFinalSemicolonIsInsideUnterminatedString) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellPromptResult prompt{};
    constexpr std::string_view query = "SELECT ';";
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_TEXT,
                                          reinterpret_cast<const uint8_t*>(query.data()), query.size(), &prompt),
              DASHQL_SHELL_OK);
    dashql_shell_prompt_result_destroy(&prompt);

    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_ENTER, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.action, DASHQL_SHELL_INPUT_NONE);
    EXPECT_EQ(PromptText(prompt), "SELECT ';\n");
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, NavigatesMultilinePromptWithUpAndDown) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellPromptResult prompt{};
    constexpr std::string_view query = "SELECT ab\nFROM table";
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_TEXT,
                                          reinterpret_cast<const uint8_t*>(query.data()), query.size(), &prompt),
              DASHQL_SHELL_OK);
    dashql_shell_prompt_result_destroy(&prompt);

    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_UP, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.cursor_byte_offset, std::string_view{"SELECT ab"}.size());
    dashql_shell_prompt_result_destroy(&prompt);

    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_DOWN, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.cursor_byte_offset, query.size() - 1);
    dashql_shell_prompt_result_destroy(&prompt);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_UP, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_ESCAPE, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.cursor_byte_offset, std::string_view{"SELECT ab"}.size());
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ContinuesHistoryNavigationAfterLoadingMultilinePrompt) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    std::string history;
    for (const auto query : {std::string_view{"SELECT 1;"}, std::string_view{"SELECT 2\n;"}}) {
        const auto size = static_cast<uint32_t>(query.size());
        for (size_t i = 0; i < sizeof(size); ++i) history.push_back(static_cast<char>(size >> (i * 8)));
        history.append(query);
    }
    DashQLShellResult operation{};
    ASSERT_EQ(dashql_shell_history_import(shell, reinterpret_cast<const uint8_t*>(history.data()), history.size(),
                                          &operation),
              DASHQL_SHELL_OK);
    dashql_shell_result_destroy(&operation);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_set(shell, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    dashql_shell_prompt_result_destroy(&prompt);

    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_UP, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), "SELECT 2\n;");
    dashql_shell_prompt_result_destroy(&prompt);
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_UP, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), "SELECT 1;");
    dashql_shell_prompt_result_destroy(&prompt);
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_DOWN, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), "SELECT 2\n;");
    dashql_shell_prompt_result_destroy(&prompt);
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_DOWN, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_TRUE(PromptText(prompt).empty());
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ContinuesTerminalHistoryNavigationPastCompletionOverlay) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    std::string history;
    for (const auto query : {std::string_view{"SELECT 1;"}, std::string_view{"SELECT 2;"}}) {
        const auto size = static_cast<uint32_t>(query.size());
        for (size_t i = 0; i < sizeof(size); ++i) history.push_back(static_cast<char>(size >> (i * 8)));
        history.append(query);
    }
    DashQLShellResult operation{};
    ASSERT_EQ(dashql_shell_history_import(shell, reinterpret_cast<const uint8_t*>(history.data()), history.size(),
                                          &operation),
              DASHQL_SHELL_OK);
    dashql_shell_result_destroy(&operation);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_UP, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_UP, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), "SELECT 1;");
    dashql_shell_prompt_result_destroy(&prompt);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_DOWN, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), "SELECT 2;");
    dashql_shell_prompt_result_destroy(&prompt);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_DOWN, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_TRUE(PromptText(prompt).empty());
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, NavigatesToPromptStartAndEnd) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellPromptResult prompt{};
    constexpr std::string_view query = "SELECT 👩‍💻";
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_TEXT,
                                          reinterpret_cast<const uint8_t*>(query.data()), query.size(), &prompt),
              DASHQL_SHELL_OK);
    dashql_shell_prompt_result_destroy(&prompt);

    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_START, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.cursor_byte_offset, 0u);
    dashql_shell_prompt_result_destroy(&prompt);

    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_END, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.cursor_byte_offset, query.size());
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, RendersHighlightedTerminalPrompt) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    const std::string prompt = "db> ";
    ASSERT_EQ(
        dashql_shell_terminal_open(shell, reinterpret_cast<const uint8_t*>(prompt.data()), prompt.size(), &output),
        DASHQL_SHELL_OK);
    std::string expected;
    expected.append(dashql::shell::vt100::kDisableAutoWrap);
    expected.append(dashql::shell::vt100::kCarriageReturn);
    expected.append(dashql::shell::vt100::kEraseEntireLine);
    expected.append(dashql::shell::vt100::kBold);
    expected.append("db> ");
    expected.append(dashql::shell::vt100::kResetAttributes);
    expected.append(dashql::shell::vt100::kCarriageReturn);
    expected.append(dashql::shell::vt100::Sequence(4, dashql::shell::vt100::Command::kCursorForward));
    EXPECT_EQ((std::string_view{reinterpret_cast<const char*>(output.data_ptr), output.data_length}), expected);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "SELECT '界' FROM t";
    ASSERT_EQ(dashql_shell_terminal_consume(shell, DASHQL_SHELL_INPUT_TEXT,
                                            reinterpret_cast<const uint8_t*>(query.data()), query.size(), &output),
              DASHQL_SHELL_OK);
    const std::string rendered{reinterpret_cast<const char*>(output.data_ptr), output.data_length};
    EXPECT_NE(rendered.find(std::string{dashql::shell::vt100::kBoldForegroundPink} + "SELECT" +
                            std::string{dashql::shell::vt100::kResetAttributes}),
              std::string::npos);
    EXPECT_NE(rendered.find(std::string{dashql::shell::vt100::kForegroundCoral} + "'界'" +
                            std::string{dashql::shell::vt100::kResetAttributes}),
              std::string::npos);
    EXPECT_NE(rendered.find(std::string{dashql::shell::vt100::kForegroundSilver} + "t" +
                            std::string{dashql::shell::vt100::kResetAttributes}),
              std::string::npos);
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ConsumesSemanticTerminalInput) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "SELECT 1;";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_NONE);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_ENTER, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_SUBMIT);
    EXPECT_NE(TerminalData(output).find(dashql::shell::vt100::kEnableAutoWrap), std::string_view::npos);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_ESCAPE, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_EXIT);
    EXPECT_NE(TerminalData(output).find(dashql::shell::vt100::kEnableAutoWrap), std::string_view::npos);
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ScopesAutoWrapToTerminalOutput) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    const auto opened = TerminalData(output);
    EXPECT_TRUE(opened.starts_with(dashql::shell::vt100::kDisableAutoWrap)) << opened;
    dashql_shell_terminal_result_destroy(&output);

    constexpr std::string_view query_output = "a query result";
    ASSERT_EQ(dashql_shell_terminal_finish_query(shell, reinterpret_cast<const uint8_t*>(query_output.data()),
                                                 query_output.size(), false, &output),
              DASHQL_SHELL_OK);
    const auto finished = TerminalData(output);
    const auto enabled = finished.find(dashql::shell::vt100::kEnableAutoWrap);
    const auto result = finished.find(query_output);
    const auto disabled = finished.find(dashql::shell::vt100::kDisableAutoWrap);
    EXPECT_LT(enabled, result) << finished;
    EXPECT_LT(result, disabled) << finished;
    dashql_shell_terminal_result_destroy(&output);

    constexpr std::string_view status = "working";
    ASSERT_EQ(
        dashql_shell_terminal_status(shell, reinterpret_cast<const uint8_t*>(status.data()), status.size(), &output),
        DASHQL_SHELL_OK);
    const auto status_output = TerminalData(output);
    EXPECT_LT(status_output.find(dashql::shell::vt100::kEnableAutoWrap), status_output.find(status)) << status_output;
    EXPECT_LT(status_output.find(status), status_output.find(dashql::shell::vt100::kDisableAutoWrap)) << status_output;
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, LeavesBlankLineAfterTerminalResult) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    constexpr std::string_view query_output = "╰────────╯\r\n";
    ASSERT_EQ(dashql_shell_terminal_finish_query(shell, reinterpret_cast<const uint8_t*>(query_output.data()),
                                                 query_output.size(), false, &output),
              DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find(std::string{query_output} + std::string{dashql::shell::vt100::kNewLine}),
              std::string_view::npos)
        << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, RendersAndClearsSingleLineQueryProgress) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 20);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    constexpr std::string_view message = "  Executing\nquery\tbatch  ";
    ASSERT_EQ(dashql_shell_terminal_query_progress(shell, reinterpret_cast<const uint8_t*>(message.data()),
                                                   message.size(), false, &output),
              DASHQL_SHELL_OK);
    const auto first = std::string{TerminalData(output)};
    EXPECT_NE(first.find("⠋ Executing query..."), std::string::npos) << first;
    EXPECT_EQ(first.find('\n'), std::string::npos) << first;
    EXPECT_TRUE(first.starts_with(dashql::shell::vt100::kDisableAutoWrap)) << first;
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(dashql_shell_terminal_query_progress(shell, nullptr, 0, true, &output), DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find("⠙ Executing query..."), std::string::npos) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(dashql_shell_terminal_query_progress_clear(shell, &output), DASHQL_SHELL_OK);
    std::string expected_clear{dashql::shell::vt100::kCarriageReturn};
    expected_clear.append(dashql::shell::vt100::kEraseEntireLine);
    expected_clear.append(dashql::shell::vt100::kEnableAutoWrap);
    EXPECT_EQ(TerminalData(output), expected_clear);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(dashql_shell_terminal_query_progress_clear(shell, &output), DASHQL_SHELL_OK);
    EXPECT_TRUE(TerminalData(output).empty());
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, StartsQueryProgressAfterLastMultilinePromptRow) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    constexpr std::string_view query = "SELECT 42\n;";
    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_set(shell, reinterpret_cast<const uint8_t*>(query.data()), query.size(), &prompt),
              DASHQL_SHELL_OK);
    dashql_shell_prompt_result_destroy(&prompt);
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_UP, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    dashql_shell_prompt_result_destroy(&prompt);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_ENTER, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_SUBMIT);
    const auto submitted = std::string{TerminalData(output)};
    const auto cursor_down = dashql::shell::vt100::Sequence(1, dashql::shell::vt100::Command::kCursorDown);
    EXPECT_NE(submitted.find(cursor_down + std::string{dashql::shell::vt100::kEnableAutoWrap} +
                             std::string{dashql::shell::vt100::kNewLine}),
              std::string::npos)
        << submitted;
    dashql_shell_terminal_result_destroy(&output);

    constexpr std::string_view message = "Executing query";
    ASSERT_EQ(dashql_shell_terminal_query_progress(shell, reinterpret_cast<const uint8_t*>(message.data()),
                                                   message.size(), false, &output),
              DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find("⠋ Executing query"), std::string_view::npos) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ReflowsLongPromptWithoutRepeatingPreviousRender) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 16);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "SELECT 123456789"), DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find(dashql::shell::vt100::Sequence(1, dashql::shell::vt100::Command::kCursorDown) +
                                        std::string{dashql::shell::vt100::kBold} + "     -> " +
                                        std::string{dashql::shell::vt100::kResetAttributes}),
              std::string_view::npos);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "0"), DASHQL_SHELL_OK);
    const auto rendered = TerminalData(output);
    EXPECT_EQ(CountOccurrences(rendered, "SELECT"), 1u) << rendered;
    EXPECT_EQ(CountOccurrences(rendered, "23456789"), 1u) << rendered;
    EXPECT_EQ(CountOccurrences(rendered, "     -> "), 2u) << rendered;
    EXPECT_GE(CountOccurrences(rendered, dashql::shell::vt100::kEraseEntireLine), 2u) << rendered;
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ReflowsLongPromptFromContinuationRow) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 16);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "SELECT 12"), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "3"), DASHQL_SHELL_OK);
    const auto rendered = TerminalData(output);
    EXPECT_EQ(CountOccurrences(rendered, "SELECT"), 1u) << rendered;
    EXPECT_EQ(CountOccurrences(rendered, "     -> "), 1u) << rendered;
    const auto cursor_up = dashql::shell::vt100::Sequence(1, dashql::shell::vt100::Command::kCursorUp);
    const auto cursor_down = dashql::shell::vt100::Sequence(1, dashql::shell::vt100::Command::kCursorDown);
    const auto cleared_rows = cursor_up + std::string{dashql::shell::vt100::kCarriageReturn} +
                              std::string{dashql::shell::vt100::kEraseEntireLine} + cursor_down +
                              std::string{dashql::shell::vt100::kCarriageReturn} +
                              std::string{dashql::shell::vt100::kEraseEntireLine} + cursor_up +
                              std::string{dashql::shell::vt100::kCarriageReturn};
    EXPECT_TRUE(rendered.starts_with(cleared_rows)) << rendered;
    EXPECT_FALSE(rendered.starts_with(cursor_up + std::string{dashql::shell::vt100::kCarriageReturn} +
                                      std::string{dashql::shell::vt100::kEraseEntireLine} +
                                      std::string{dashql::shell::vt100::kNewLine}))
        << rendered;
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, RedrawsLongStringWithoutScrollingDuringCleanup) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    constexpr std::string_view prompt = "hyper> ";
    ASSERT_EQ(
        dashql_shell_terminal_open(shell, reinterpret_cast<const uint8_t*>(prompt.data()), prompt.size(), &output),
        DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "select '" + std::string(170, 'o') + "'";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "f"), DASHQL_SHELL_OK);
    const auto rendered = TerminalData(output);
    EXPECT_EQ(CountOccurrences(rendered, "hyper> "), 1u) << rendered;
    EXPECT_EQ(CountOccurrences(rendered, "select"), 1u) << rendered;
    const auto first_rendered_row = rendered.find("hyper> ");
    ASSERT_NE(first_rendered_row, std::string_view::npos) << rendered;
    EXPECT_EQ(rendered.substr(0, first_rendered_row).find(dashql::shell::vt100::kNewLine), std::string_view::npos)
        << rendered;
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, AllocatesNewRowsBeforeRedrawingLongPrompt) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    constexpr std::string_view prompt = "hyper> ";
    ASSERT_EQ(
        dashql_shell_terminal_open(shell, reinterpret_cast<const uint8_t*>(prompt.data()), prompt.size(), &output),
        DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "select '" + std::string(135, 'o') + "'";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, " as select"), DASHQL_SHELL_OK);
    const auto rendered = TerminalData(output);
    EXPECT_EQ(CountOccurrences(rendered, "hyper> "), 1u) << rendered;
    const auto first_prompt = rendered.find("hyper> ");
    ASSERT_NE(first_prompt, std::string_view::npos) << rendered;
    EXPECT_NE(rendered.substr(0, first_prompt).find(dashql::shell::vt100::kNewLine), std::string_view::npos)
        << rendered;
    EXPECT_NE(rendered.substr(0, first_prompt)
                  .find(dashql::shell::vt100::Sequence(2, dashql::shell::vt100::Command::kCursorUp)),
              std::string_view::npos)
        << rendered;
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, RendersInlineCompletionHintAtRightMarginWithAutoWrapDisabled) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 173);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    constexpr std::string_view prompt = "hyper> ";
    ASSERT_EQ(
        dashql_shell_terminal_open(shell, reinterpret_cast<const uint8_t*>(prompt.data()), prompt.size(), &output),
        DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "select '" + std::string(154, 'o') + "' a";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    const auto rendered = TerminalData(output);
    EXPECT_EQ(CountOccurrences(rendered, "hyper> "), 1u) << rendered;
    EXPECT_NE(rendered.find(std::string{dashql::shell::vt100::kForegroundBrightBlack} + " into"),
              std::string_view::npos)
        << rendered;
    EXPECT_NE(rendered.find(dashql::shell::vt100::kSaveCursor), std::string_view::npos) << rendered;
    EXPECT_NE(rendered.find(dashql::shell::vt100::kRestoreCursor), std::string_view::npos) << rendered;
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "s"), DASHQL_SHELL_OK);
    EXPECT_EQ(CountOccurrences(TerminalData(output), "hyper> "), 1u) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, KeepsCompletionOverlayInsideRightBorder) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 12);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, " sel"), DASHQL_SHELL_OK);
    const auto rendered = TerminalData(output);
    const auto top = rendered.find("╭");
    ASSERT_NE(top, std::string_view::npos) << rendered;
    EXPECT_NE(rendered.find("╭─────────╮"), std::string_view::npos) << rendered;
    EXPECT_EQ(rendered.find(dashql::shell::vt100::Sequence(9, dashql::shell::vt100::Command::kCursorForward) +
                            std::string{dashql::shell::vt100::kEraseEntireLine} +
                            std::string{dashql::shell::vt100::kForegroundBrightBlack} + "╭"),
              std::string_view::npos)
        << rendered;
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, NavigatesAndAcceptsTerminalCompletionOverlay) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "sel";
    const auto query_status = ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query);
    ASSERT_EQ(query_status, DASHQL_SHELL_OK) << TerminalData(output);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_NONE);
    EXPECT_NE(TerminalData(output).find(dashql::shell::vt100::kReverseVideo), std::string_view::npos);
    EXPECT_NE(TerminalData(output).find("select"), std::string_view::npos);
    const auto completion_anchor = dashql::shell::vt100::Sequence(1, dashql::shell::vt100::Command::kCursorDown) +
                                   dashql::shell::vt100::Sequence(8, dashql::shell::vt100::Command::kCursorForward);
    EXPECT_NE(
        TerminalData(output).find(completion_anchor + std::string{dashql::shell::vt100::kForegroundBrightBlack} + "╭"),
        std::string_view::npos);
    EXPECT_EQ(
        TerminalData(output).find(dashql::shell::vt100::Sequence(8, dashql::shell::vt100::Command::kCursorForward) +
                                  std::string{dashql::shell::vt100::kEraseEntireLine}),
        std::string_view::npos);
    EXPECT_NE(TerminalData(output).find(std::string{dashql::shell::vt100::kForegroundBrightBlack} + "╰"),
              std::string_view::npos);
    EXPECT_EQ(TerminalData(output).find(std::string{dashql::shell::vt100::kEraseEntireLine} + "> "),
              std::string_view::npos);
    const std::string initial_output{TerminalData(output)};
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellCompletionResult completions{};
    ASSERT_EQ(dashql_shell_prompt_complete(shell, 50, &completions), DASHQL_SHELL_OK);
    ASSERT_GT(completions.count, 1u);
    const auto* candidates = static_cast<const DashQLShellCompletionCandidate*>(completions.candidates_ptr);
    size_t select_index = completions.count;
    for (size_t i = 0; i < completions.count; ++i) {
        if (std::string_view{reinterpret_cast<const char*>(candidates[i].completion_text_ptr),
                             candidates[i].completion_text_length} == "select") {
            select_index = i;
            break;
        }
    }
    ASSERT_LT(select_index, completions.count);

    std::string selected_output;
    for (size_t i = 0; i < select_index; ++i) {
        ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_HISTORY_NEXT, &output), DASHQL_SHELL_OK);
        EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_NONE);
        selected_output.assign(TerminalData(output));
        dashql_shell_terminal_result_destroy(&output);
    }
    if (select_index == 0) selected_output = initial_output;
    EXPECT_NE(selected_output.find(std::string{dashql::shell::vt100::kForegroundBrightBlack} + "ect"),
              std::string::npos);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_NONE);
    EXPECT_NE(TerminalData(output).find(std::string{dashql::shell::vt100::kBoldForegroundPink} + "select" +
                                        std::string{dashql::shell::vt100::kResetAttributes}),
              std::string_view::npos)
        << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), "select");
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_completion_result_destroy(&completions);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ListsHintsAndAcceptsColumnAfterFullyQualifiedTableAlias) {
    dashql::Catalog catalog;
    dashql::Script schema{catalog};
    constexpr std::string_view schema_sql =
        "CREATE TABLE uip_iceberg.cdp_usage_nonprod_events.hyperdb_queries(event_id BIGINT, processed_rows BIGINT);";
    schema.InsertTextAt(0, schema_sql);
    schema.Analyze();
    ASSERT_NO_THROW(catalog.LoadScript(schema, 0));

    auto* shell = dashql_shell_new(&catalog, 160);
    ASSERT_NE(shell, nullptr);
    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    constexpr std::string_view query = "select * from uip_iceberg.cdp_usage_nonprod_events.hyperdb_queries q where q.";
    for (const char character : query) {
        ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, std::string_view{&character, 1}),
                  DASHQL_SHELL_OK);
        if (character != query.back()) dashql_shell_terminal_result_destroy(&output);
    }
    EXPECT_NE(TerminalData(output).find(dashql::shell::vt100::kForegroundBrightBlack), std::string_view::npos)
        << TerminalData(output);
    EXPECT_TRUE(TerminalData(output).find("event_id") != std::string_view::npos ||
                TerminalData(output).find("processed_rows") != std::string_view::npos)
        << TerminalData(output);
    EXPECT_NE(TerminalData(output).find("╭"), std::string_view::npos) << TerminalData(output);
    EXPECT_NE(TerminalData(output).find(dashql::shell::vt100::kReverseVideo), std::string_view::npos)
        << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellCompletionResult completions{};
    ASSERT_EQ(dashql_shell_prompt_complete(shell, 50, &completions), DASHQL_SHELL_OK);
    ASSERT_GT(completions.count, 0u);
    const auto* candidates = static_cast<const DashQLShellCompletionCandidate*>(completions.candidates_ptr);
    EXPECT_EQ(candidates[0].target_offset, query.size());
    EXPECT_EQ(candidates[0].target_length, 0u);
    dashql_shell_completion_result_destroy(&completions);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_NONE);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_TRUE(PromptText(prompt) == std::string{query} + "event_id" ||
                PromptText(prompt) == std::string{query} + "processed_rows")
        << PromptText(prompt);
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ListsColumnsAfterShortTableAlias) {
    dashql::Catalog catalog;
    dashql::Script schema{catalog};
    schema.InsertTextAt(0, "CREATE TABLE foo(only_column BIGINT);");
    schema.Analyze();
    ASSERT_NO_THROW(catalog.LoadScript(schema, 0));

    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);
    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    constexpr std::string_view query = "select * from foo x where x.";
    for (const char character : query) {
        ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, std::string_view{&character, 1}),
                  DASHQL_SHELL_OK);
        if (character != query.back()) dashql_shell_terminal_result_destroy(&output);
    }
    EXPECT_NE(TerminalData(output).find("only_column"), std::string_view::npos) << TerminalData(output);
    EXPECT_NE(TerminalData(output).find("╭"), std::string_view::npos) << TerminalData(output);
    EXPECT_NE(TerminalData(output).find(dashql::shell::vt100::kReverseVideo), std::string_view::npos)
        << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ListsColumnsAfterQualifiedAliasBeforeLaterPromptLines) {
    dashql::Catalog catalog;
    dashql::Script schema{catalog};
    constexpr std::string_view schema_sql =
        "CREATE TABLE uip_iceberg.cdp_usage_nonprod_events.hyperdb_queries(event_id BIGINT, processed_rows BIGINT);";
    schema.InsertTextAt(0, schema_sql);
    schema.Analyze();
    ASSERT_NO_THROW(catalog.LoadScript(schema, 0));

    auto* shell = dashql_shell_new(&catalog, 160);
    ASSERT_NE(shell, nullptr);
    DashQLShellTerminalResult output{};
    constexpr std::string_view terminal_prompt = "trino> ";
    ASSERT_EQ(dashql_shell_terminal_open(shell, reinterpret_cast<const uint8_t*>(terminal_prompt.data()),
                                         terminal_prompt.size(), &output),
              DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    constexpr std::string_view query =
        "with foo as (\nselect * from uip_iceberg.cdp_usage_nonprod_events.hyperdb_queries q where q.\n\n) ";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    constexpr std::string_view trailing = "\n\n) ";
    for (size_t i = 0; i < trailing.size(); ++i) {
        ASSERT_EQ(dashql_shell_prompt_move_left(shell, &prompt), DASHQL_SHELL_OK);
        dashql_shell_prompt_result_destroy(&prompt);
    }
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.cursor_byte_offset, query.size() - trailing.size() + 1);
    dashql_shell_prompt_result_destroy(&prompt);
    ASSERT_EQ(dashql_shell_prompt_move_left(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.cursor_byte_offset, query.size() - trailing.size());
    dashql_shell_prompt_result_destroy(&prompt);

    DashQLShellCompletionResult completions{};
    ASSERT_EQ(dashql_shell_prompt_complete(shell, 50, &completions), DASHQL_SHELL_OK);
    ASSERT_GT(completions.count, 0u);
    const auto* candidates = static_cast<const DashQLShellCompletionCandidate*>(completions.candidates_ptr);
    bool found_column = false;
    for (size_t i = 0; i < completions.count; ++i) {
        const auto completion = std::string_view{reinterpret_cast<const char*>(candidates[i].completion_text_ptr),
                                                 candidates[i].completion_text_length};
        found_column |= completion == "event_id" || completion == "processed_rows";
    }
    EXPECT_TRUE(found_column);
    dashql_shell_completion_result_destroy(&completions);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "x"), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_BACKSPACE, &output), DASHQL_SHELL_OK);
    EXPECT_TRUE(TerminalData(output).find("event_id") != std::string_view::npos ||
                TerminalData(output).find("processed_rows") != std::string_view::npos)
        << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ShowsOnlyInlineHintBeforeCompletionPrefix) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, " "), DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find(dashql::shell::vt100::kForegroundBrightBlack), std::string_view::npos);
    EXPECT_EQ(TerminalData(output).find("╭"), std::string_view::npos);
    EXPECT_EQ(TerminalData(output).find(dashql::shell::vt100::kReverseVideo), std::string_view::npos);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "s"), DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find("╭"), std::string_view::npos);
    EXPECT_NE(TerminalData(output).find(dashql::shell::vt100::kReverseVideo), std::string_view::npos);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_GT(PromptText(prompt).size(), 2u);
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, KeepsEnterAvailableForNewlineWhileCompletionIsOpen) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "sel"), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_ENTER, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_NONE);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), "sel\n");
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, DoesNotCycleTerminalCandidatesWithLeftAndRight) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "sel";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellCompletionResult completions{};
    ASSERT_EQ(dashql_shell_prompt_complete(shell, 50, &completions), DASHQL_SHELL_OK);
    ASSERT_GT(completions.count, 1u);
    const auto* candidates = static_cast<const DashQLShellCompletionCandidate*>(completions.candidates_ptr);
    const std::string expected{reinterpret_cast<const char*>(candidates[0].completion_text_ptr),
                               candidates[0].completion_text_length};

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_RIGHT, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_LEFT, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(dashql_shell_terminal_consume(shell, DASHQL_SHELL_INPUT_RIGHT, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_END, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find("╭"), std::string_view::npos) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), expected);
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_completion_result_destroy(&completions);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, CursorMovementDismissesCompletionWithoutReopeningIt) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "sel"), DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find("╭"), std::string_view::npos) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_LEFT, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(TerminalData(output).find("╭"), std::string_view::npos) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_LEFT, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(TerminalData(output).find("╭"), std::string_view::npos) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.cursor_byte_offset, 2u);
    EXPECT_EQ(PromptText(prompt), "sel");
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, CyclesInlineQualificationHintsWithLeftAndRight) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 100);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query =
        "CREATE TABLE orders(customer_id BIGINT); CREATE TABLE customers(customer_id BIGINT); "
        "SELECT customer_id FROM orders o JOIN customers c ON o.customer_id = c.customer_id "
        "WHERE customer_id";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellCompletionResult completions{};
    ASSERT_EQ(dashql_shell_prompt_complete(shell, 50, &completions), DASHQL_SHELL_OK);
    const auto* candidates = static_cast<const DashQLShellCompletionCandidate*>(completions.candidates_ptr);
    size_t customer_id_index = completions.count;
    for (size_t i = 0; i < completions.count; ++i) {
        if (std::string_view{reinterpret_cast<const char*>(candidates[i].completion_text_ptr),
                             candidates[i].completion_text_length} == "customer_id") {
            customer_id_index = i;
            break;
        }
    }
    ASSERT_LT(customer_id_index, completions.count);

    for (size_t i = 0; i < customer_id_index; ++i) {
        ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_HISTORY_NEXT, &output), DASHQL_SHELL_OK);
        dashql_shell_terminal_result_destroy(&output);
    }

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_RIGHT, &output), DASHQL_SHELL_OK);
    const std::string right_output{TerminalData(output)};
    EXPECT_NE(right_output.find(dashql::shell::vt100::Sequence(2, dashql::shell::vt100::Command::kInsertCharacter)),
              std::string::npos);
    EXPECT_NE(right_output.find("c."), std::string::npos);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_LEFT, &output), DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find("o."), std::string_view::npos);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_NE(PromptText(prompt).find("o.customer_id"), std::string_view::npos);
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_completion_result_destroy(&completions);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, AppliesKeywordCompletionInMultipleSteps) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 100);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "SELECT * FROM supplier gro";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellCompletionResult completions{};
    ASSERT_EQ(dashql_shell_prompt_complete(shell, 50, &completions), DASHQL_SHELL_OK);
    const auto* candidates = static_cast<const DashQLShellCompletionCandidate*>(completions.candidates_ptr);
    size_t group_index = completions.count;
    for (size_t i = 0; i < completions.count; ++i) {
        if (std::string_view{reinterpret_cast<const char*>(candidates[i].completion_text_ptr),
                             candidates[i].completion_text_length} == "group") {
            group_index = i;
            break;
        }
    }
    ASSERT_LT(group_index, completions.count);

    for (size_t i = 0; i < group_index; ++i) {
        ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_HISTORY_NEXT, &output), DASHQL_SHELL_OK);
        dashql_shell_terminal_result_destroy(&output);
    }

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find(std::string{dashql::shell::vt100::kBoldForegroundPink} + "SELECT" +
                                        std::string{dashql::shell::vt100::kResetAttributes}),
              std::string_view::npos)
        << TerminalData(output);
    EXPECT_NE(TerminalData(output).find(std::string{dashql::shell::vt100::kForegroundSilver} + "supplier" +
                                        std::string{dashql::shell::vt100::kResetAttributes}),
              std::string_view::npos)
        << TerminalData(output);
    EXPECT_NE(TerminalData(output).find(std::string{dashql::shell::vt100::kBoldForegroundPink} + "group" +
                                        std::string{dashql::shell::vt100::kResetAttributes}),
              std::string_view::npos)
        << TerminalData(output);
    EXPECT_NE(TerminalData(output).find(std::string{dashql::shell::vt100::kForegroundBrightBlack} + " by"),
              std::string_view::npos)
        << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), "SELECT * FROM supplier group");
    dashql_shell_prompt_result_destroy(&prompt);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), "SELECT * FROM supplier group by");
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_completion_result_destroy(&completions);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, AnchorsCompletionBelowCursorInMultilinePrompt) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 100);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "sel\nFROM supplier";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    for (size_t i = 0; i < std::string_view{"\nFROM supplier"}.size(); ++i) {
        ASSERT_EQ(dashql_shell_prompt_move_left(shell, &prompt), DASHQL_SHELL_OK);
        dashql_shell_prompt_result_destroy(&prompt);
    }

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "x"), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_BACKSPACE, &output), DASHQL_SHELL_OK);
    const auto rendered = TerminalData(output);
    EXPECT_EQ(rendered.find(dashql::shell::vt100::Sequence(9, dashql::shell::vt100::Command::kInsertLine)),
              std::string_view::npos);
    EXPECT_NE(rendered.find(dashql::shell::vt100::Sequence(1, dashql::shell::vt100::Command::kCursorDown) +
                            dashql::shell::vt100::Sequence(8, dashql::shell::vt100::Command::kCursorForward) +
                            std::string{dashql::shell::vt100::kForegroundBrightBlack} + "╭"),
              std::string_view::npos);
    EXPECT_EQ(rendered.find(dashql::shell::vt100::Sequence(8, dashql::shell::vt100::Command::kCursorForward) +
                            std::string{dashql::shell::vt100::kEraseEntireLine}),
              std::string_view::npos);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_ESCAPE, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(TerminalData(output).find(dashql::shell::vt100::Sequence(9, dashql::shell::vt100::Command::kDeleteLine)),
              std::string_view::npos);
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, RendersInlineCompletionHintBeforeLaterPromptLines) {
    dashql::Catalog catalog;
    dashql::Script schema{catalog};
    constexpr std::string_view schema_sql = "CREATE TABLE hyperdb_queries(query_id BIGINT);";
    schema.InsertTextAt(0, schema_sql);
    schema.Analyze();
    ASSERT_NO_THROW(catalog.LoadScript(schema, 0));

    auto* shell = dashql_shell_new(&catalog, 100);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    constexpr std::string_view prompt = "trino> ";
    ASSERT_EQ(
        dashql_shell_terminal_open(shell, reinterpret_cast<const uint8_t*>(prompt.data()), prompt.size(), &output),
        DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    constexpr std::string_view query = "with foo as (\nselect * from hyperdb_quer\n\n) ";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt_result{};
    constexpr std::string_view trailing = "\n\n) ";
    for (size_t i = 0; i < trailing.size(); ++i) {
        ASSERT_EQ(dashql_shell_prompt_move_left(shell, &prompt_result), DASHQL_SHELL_OK);
        dashql_shell_prompt_result_destroy(&prompt_result);
    }

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "x"), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_BACKSPACE, &output), DASHQL_SHELL_OK);
    const auto rendered = TerminalData(output);
    EXPECT_NE(rendered.find(std::string{dashql::shell::vt100::kForegroundBrightBlack} + "ies"), std::string_view::npos)
        << rendered;
    EXPECT_NE(rendered.find(dashql::shell::vt100::Sequence(3, dashql::shell::vt100::Command::kInsertCharacter)),
              std::string_view::npos)
        << rendered;
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, RendersAndAcceptsQualificationHintBeforeCursor) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 100);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query =
        "SELECT customer_id FROM orders o JOIN customers c ON o.customer_id = c.customer_id "
        "WHERE customer_id";
    const std::string schema = "CREATE TABLE orders(customer_id BIGINT); CREATE TABLE customers(customer_id BIGINT); ";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, schema), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellCompletionResult completions{};
    ASSERT_EQ(dashql_shell_prompt_complete(shell, 50, &completions), DASHQL_SHELL_OK);
    const auto* candidates = static_cast<const DashQLShellCompletionCandidate*>(completions.candidates_ptr);
    size_t customer_id_index = completions.count;
    for (size_t i = 0; i < completions.count; ++i) {
        if (std::string_view{reinterpret_cast<const char*>(candidates[i].completion_text_ptr),
                             candidates[i].completion_text_length} == "customer_id") {
            customer_id_index = i;
            break;
        }
    }
    ASSERT_LT(customer_id_index, completions.count);

    std::string selected_output;
    for (size_t i = 0; i < customer_id_index; ++i) {
        ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_HISTORY_NEXT, &output), DASHQL_SHELL_OK);
        selected_output.assign(TerminalData(output));
        dashql_shell_terminal_result_destroy(&output);
    }
    if (customer_id_index == 0) {
        ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_HISTORY_NEXT, &output), DASHQL_SHELL_OK);
        dashql_shell_terminal_result_destroy(&output);
        ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_HISTORY_PREVIOUS, &output), DASHQL_SHELL_OK);
        selected_output.assign(TerminalData(output));
        dashql_shell_terminal_result_destroy(&output);
    }
    EXPECT_NE(selected_output.find(dashql::shell::vt100::Sequence(2, dashql::shell::vt100::Command::kInsertCharacter)),
              std::string::npos);
    EXPECT_NE(selected_output.find(dashql::shell::vt100::kForegroundBrightBlack), std::string::npos);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    EXPECT_NE(
        TerminalData(output).find(dashql::shell::vt100::Sequence(2, dashql::shell::vt100::Command::kInsertCharacter)),
        std::string_view::npos);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_NE(PromptText(prompt).find(".customer_id"), std::string_view::npos);
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_completion_result_destroy(&completions);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, AutoQualifiesNonDefaultDatabaseTableOnFirstTab) {
    dashql::Catalog catalog;
    dashql::Script schema{catalog};
    schema.InsertTextAt(0, "CREATE TABLE \"Salesforce\".public.\"Account\"(id BIGINT);");
    schema.Analyze();
    ASSERT_NO_THROW(catalog.LoadScript(schema, 0));

    auto* shell = dashql_shell_new(&catalog, 100, true);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    constexpr std::string_view query = "select * from Acc";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_LT(SelectTerminalCompletion(shell, "\"Account\"", &output), 50u);
    EXPECT_NE(TerminalData(output).find("\"Salesforce\".public."), std::string_view::npos) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), "select * from \"Salesforce\".public.\"Account\"");
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, CyclesAutoQualifiedTableOptionsWithLeftAndRight) {
    dashql::Catalog catalog;
    dashql::Script schema{catalog};
    schema.InsertTextAt(0,
                        "CREATE TABLE alpha.public.accounts(id BIGINT); "
                        "CREATE TABLE beta.public.accounts(id BIGINT);");
    schema.Analyze();
    ASSERT_NO_THROW(catalog.LoadScript(schema, 0));

    auto* shell = dashql_shell_new(&catalog, 100, true);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "select * from acc"), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_LT(SelectTerminalCompletion(shell, "accounts", &output), 50u);
    EXPECT_NE(TerminalData(output).find("1/2"), std::string_view::npos) << TerminalData(output);
    const bool first_is_alpha = TerminalData(output).find("alpha.public.") != std::string_view::npos;
    const bool first_is_beta = TerminalData(output).find("beta.public.") != std::string_view::npos;
    EXPECT_NE(first_is_alpha, first_is_beta) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_RIGHT, &output), DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find("2/2"), std::string_view::npos) << TerminalData(output);
    EXPECT_EQ(TerminalData(output).find(first_is_alpha ? "alpha.public." : "beta.public."), std::string_view::npos)
        << TerminalData(output);
    EXPECT_NE(TerminalData(output).find(first_is_alpha ? "beta.public." : "alpha.public."), std::string_view::npos)
        << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_LEFT, &output), DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find("1/2"), std::string_view::npos) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_LEFT, &output), DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find("2/2"), std::string_view::npos) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), first_is_alpha ? "select * from beta.public.accounts"
                                                 : "select * from alpha.public.accounts");
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, NarrowCompletionListKeepsLeftAndRightAsCursorKeys) {
    dashql::Catalog catalog;
    dashql::Script schema{catalog};
    schema.InsertTextAt(0,
                        "CREATE TABLE alpha.public.accounts(id BIGINT); "
                        "CREATE TABLE beta.public.accounts(id BIGINT);");
    schema.Analyze();
    ASSERT_NO_THROW(catalog.LoadScript(schema, 0));

    auto* shell = dashql_shell_new(&catalog, 12, true);
    ASSERT_NE(shell, nullptr);
    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "acc"), DASHQL_SHELL_OK);
    EXPECT_EQ(TerminalData(output).find("1/2"), std::string_view::npos) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_LEFT, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(TerminalData(output).find("╭"), std::string_view::npos) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.cursor_byte_offset, 3u);
    EXPECT_EQ(PromptText(prompt), "acc");
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, DoesNotAutoQualifyDefaultDatabaseTable) {
    dashql::Catalog catalog;
    dashql::Script schema{catalog};
    schema.InsertTextAt(0, "CREATE TABLE default.public.orders(id BIGINT);");
    schema.Analyze();
    ASSERT_NO_THROW(catalog.LoadScript(schema, 0));

    auto* shell = dashql_shell_new(&catalog, 100, true);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, "select * from ord"), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_LT(SelectTerminalCompletion(shell, "orders", &output), 50u);
    EXPECT_EQ(TerminalData(output).find("default.public."), std::string_view::npos) << TerminalData(output);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), "select * from orders");
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, EscapeDismissesTerminalCompletionBeforeExiting) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "sel";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_ESCAPE, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_NONE);
    EXPECT_FALSE(TerminalData(output).empty());
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_ESCAPE, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_EXIT);
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

}  // namespace
