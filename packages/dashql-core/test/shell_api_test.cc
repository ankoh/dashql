#include "dashql/shell/api.h"

#include <string>
#include <string_view>

#include "dashql/catalog.h"
#include "dashql/shell/vt100.h"
#include "gtest/gtest.h"

namespace {

std::string_view TerminalData(const DashQLShellTerminalResult& result) {
    return {reinterpret_cast<const char*>(result.data_ptr), result.data_length};
}

std::string_view PromptText(const DashQLShellPromptResult& result) {
    return {reinterpret_cast<const char*>(result.text_ptr), result.text_length};
}

uint32_t ConsumeTerminal(DashQLShell* shell,
                         uint32_t key,
                         DashQLShellTerminalResult* result,
                         std::string_view text = {}) {
    return dashql_shell_terminal_consume(shell, key, reinterpret_cast<const uint8_t*>(text.data()), text.size(), result);
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
    EXPECT_EQ(
        (std::string_view{reinterpret_cast<const char*>(operation.data_ptr + 16), operation.data_length - 16}),
        "select 01");
    dashql_shell_result_destroy(&operation);
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
    EXPECT_EQ(
        (std::string_view{reinterpret_cast<const char*>(operation.data_ptr + 16), operation.data_length - 16}),
        "SELECT ';' AS value");
    dashql_shell_result_destroy(&operation);

    const auto history = dashql_shell_history_export(shell, &operation);
    ASSERT_EQ(history, DASHQL_SHELL_OK);
    const auto history_data = std::string_view{reinterpret_cast<const char*>(operation.data_ptr), operation.data_length};
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
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_TEXT,
                                          reinterpret_cast<const uint8_t*>(incomplete.data()), incomplete.size(), &prompt),
              DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.action, DASHQL_SHELL_INPUT_NONE);
    dashql_shell_prompt_result_destroy(&prompt);

    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_ENTER, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.action, DASHQL_SHELL_INPUT_NONE);
    EXPECT_EQ((std::string_view{reinterpret_cast<const char*>(prompt.text_ptr), prompt.text_length}), "select 1\n");
    dashql_shell_prompt_result_destroy(&prompt);

    const std::string terminator = ";";
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_TEXT,
                                          reinterpret_cast<const uint8_t*>(terminator.data()), terminator.size(), &prompt),
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

TEST(ShellApiTest, RendersHighlightedTerminalPrompt) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    const std::string prompt = "db> ";
    ASSERT_EQ(dashql_shell_terminal_open(shell, reinterpret_cast<const uint8_t*>(prompt.data()), prompt.size(), false,
                                         &output),
              DASHQL_SHELL_OK);
    std::string expected;
    expected.append(dashql::shell::vt100::kCarriageReturn);
    expected.append(dashql::shell::vt100::kEraseEntireLine);
    expected.append("db> ");
    expected.append(dashql::shell::vt100::kCarriageReturn);
    expected.append(dashql::shell::vt100::kControlSequenceIntroducer);
    expected.append("4");
    expected.append(dashql::shell::vt100::kCursorForwardCommand);
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
    EXPECT_NE(rendered.find(std::string{dashql::shell::vt100::kForegroundTeal} + "t" +
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
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, false, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "SELECT 1;";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_NONE);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_ENTER, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_SUBMIT);
    dashql_shell_terminal_result_destroy(&output);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_ESCAPE, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_EXIT);
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, NavigatesAndAcceptsTerminalCompletionOverlay) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, false, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "sel";
    const auto query_status = ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query);
    ASSERT_EQ(query_status, DASHQL_SHELL_OK) << TerminalData(output);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_NONE);
    EXPECT_NE(TerminalData(output).find(dashql::shell::vt100::kReverseVideo), std::string_view::npos);
    EXPECT_NE(TerminalData(output).find("select"), std::string_view::npos);
    EXPECT_NE(TerminalData(output).find("\x1b[1B\x1b[8C\x1b[2K\x1b[90m╭"), std::string_view::npos);
    EXPECT_NE(TerminalData(output).find("\x1b[90m╰"), std::string_view::npos);
    EXPECT_EQ(TerminalData(output).find("\x1b[2K> "), std::string_view::npos);
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

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_ENTER, &output), DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_NONE);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), "select");
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_completion_result_destroy(&completions);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, DoesNotCycleTerminalCandidatesWithLeftAndRight) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, false, &output), DASHQL_SHELL_OK);
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

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_ENTER, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    ASSERT_EQ(dashql_shell_prompt_move_right(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(PromptText(prompt), expected);
    dashql_shell_prompt_result_destroy(&prompt);
    dashql_shell_completion_result_destroy(&completions);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, CyclesInlineQualificationHintsWithLeftAndRight) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 100);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, false, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "CREATE TABLE orders(customer_id BIGINT); CREATE TABLE customers(customer_id BIGINT); "
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
    EXPECT_NE(right_output.find(dashql::shell::vt100::kInsertCharacterCommand), std::string::npos);
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
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, false, &output), DASHQL_SHELL_OK);
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
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, false, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "sel\nFROM supplier";
    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TEXT, &output, query), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    DashQLShellPromptResult prompt{};
    for (size_t i = 0; i < std::string_view{"\nFROM supplier"}.size(); ++i) {
        ASSERT_EQ(dashql_shell_prompt_move_left(shell, &prompt), DASHQL_SHELL_OK);
        dashql_shell_prompt_result_destroy(&prompt);
    }

    ASSERT_EQ(dashql_shell_terminal_consume(shell, DASHQL_SHELL_INPUT_RIGHT, nullptr, 0, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);
    ASSERT_EQ(dashql_shell_terminal_consume(shell, DASHQL_SHELL_INPUT_LEFT, nullptr, 0, &output), DASHQL_SHELL_OK);
    const auto rendered = TerminalData(output);
    EXPECT_NE(rendered.find("\x1b[1B\x1b[8C\x1b[2K\x1b[90m╭"), std::string_view::npos);
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, RendersAndAcceptsQualificationHintBeforeCursor) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 100);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, false, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "SELECT customer_id FROM orders o JOIN customers c ON o.customer_id = c.customer_id "
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
    EXPECT_NE(selected_output.find(dashql::shell::vt100::kInsertCharacterCommand), std::string::npos);
    EXPECT_NE(selected_output.find(dashql::shell::vt100::kForegroundBrightBlack), std::string::npos);

    ASSERT_EQ(ConsumeTerminal(shell, DASHQL_SHELL_INPUT_TAB, &output), DASHQL_SHELL_OK);
    EXPECT_NE(TerminalData(output).find(dashql::shell::vt100::kInsertCharacterCommand), std::string_view::npos);
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

TEST(ShellApiTest, EscapeDismissesTerminalCompletionBeforeExiting) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, false, &output), DASHQL_SHELL_OK);
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
