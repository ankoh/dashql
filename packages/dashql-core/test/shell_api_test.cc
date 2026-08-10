#include "dashql/shell/api.h"

#include <string>

#include "dashql/catalog.h"
#include "dashql/shell/vt100.h"
#include "gtest/gtest.h"

namespace {

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

TEST(ShellApiTest, ConsumesRawTerminalData) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellTerminalResult output{};
    ASSERT_EQ(dashql_shell_terminal_open(shell, nullptr, 0, false, &output), DASHQL_SHELL_OK);
    dashql_shell_terminal_result_destroy(&output);

    const std::string query = "SELECT 1;";
    ASSERT_EQ(dashql_shell_terminal_consume_data(shell, reinterpret_cast<const uint8_t*>(query.data()), query.size(),
                                                 &output),
              DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_NONE);
    dashql_shell_terminal_result_destroy(&output);

    const std::string enter{dashql::shell::vt100::kCarriageReturn};
    ASSERT_EQ(dashql_shell_terminal_consume_data(shell, reinterpret_cast<const uint8_t*>(enter.data()), enter.size(),
                                                 &output),
              DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_SUBMIT);
    dashql_shell_terminal_result_destroy(&output);

    const std::string escape{dashql::shell::vt100::kEscape};
    ASSERT_EQ(dashql_shell_terminal_consume_data(shell, reinterpret_cast<const uint8_t*>(escape.data()),
                                                 escape.size(), &output),
              DASHQL_SHELL_OK);
    EXPECT_EQ(output.action, DASHQL_SHELL_INPUT_EXIT);
    dashql_shell_terminal_result_destroy(&output);
    dashql_shell_destroy(shell);
}

}  // namespace
