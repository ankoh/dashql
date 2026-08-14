#include "dashql/shell/api.h"

#include <cstdlib>
#include <limits>
#include <memory>
#include <new>
#include <span>
#include <string>
#include <vector>

#include "dashql/shell/arrow_renderer.h"
#include "dashql/shell/shell_session.h"

struct DashQLShell {
    explicit DashQLShell(dashql::Catalog& catalog, uint32_t terminal_columns) : session{catalog, terminal_columns} {}

    dashql::shell::ShellSession session;
};

namespace {

struct PromptResultOwner {
    std::string text;
    std::string message;
};

struct CompletionResultOwner {
    std::vector<dashql::shell::CompletionCandidate> source;
    std::vector<DashQLShellCompletionCandidate> ffi;
};

void ResetResult(DashQLShellResult* result) {
    result->status = DASHQL_SHELL_OK;
    result->data_length = 0;
    result->data_ptr = nullptr;
    result->owner_ptr = nullptr;
}

void ResetPromptResult(DashQLShellPromptResult* result) {
    result->status = DASHQL_SHELL_OK;
    result->revision_low = 0;
    result->revision_high = 0;
    result->cursor_byte_offset = 0;
    result->text_length = 0;
    result->text_ptr = nullptr;
    result->message_length = 0;
    result->message_ptr = nullptr;
    result->owner_ptr = nullptr;
    result->action = DASHQL_SHELL_INPUT_NONE;
}

void ResetTerminalResult(DashQLShellTerminalResult* result) {
    result->status = DASHQL_SHELL_OK;
    result->action = DASHQL_SHELL_INPUT_NONE;
    result->data_length = 0;
    result->data_ptr = nullptr;
    result->owner_ptr = nullptr;
}

void ResetCompletionResult(DashQLShellCompletionResult* result) {
    result->count = 0;
    result->candidates_ptr = nullptr;
    result->owner_ptr = nullptr;
}

uint32_t StoreResult(DashQLShellResult* result, uint32_t status, std::string value) {
    if (value.size() > std::numeric_limits<uint32_t>::max()) {
        status = DASHQL_SHELL_INTERNAL_ERROR;
        value = "shell output exceeds the C ABI size limit";
    }
    auto owner = std::make_unique<std::string>(std::move(value));
    result->status = status;
    result->data_length = static_cast<uint32_t>(owner->size());
    result->data_ptr = reinterpret_cast<const uint8_t*>(owner->data());
    result->owner_ptr = owner.release();
    return status;
}

uint32_t StoreOperation(DashQLShellResult* result, dashql::shell::ShellOperation operation) {
    return StoreResult(result, static_cast<uint32_t>(operation.status), std::move(operation.data));
}

uint32_t StorePromptResult(DashQLShellPromptResult* result, dashql::shell::PromptSnapshot snapshot) {
    auto owner = std::make_unique<PromptResultOwner>();
    owner->text = std::move(snapshot.text);
    owner->message = std::move(snapshot.message);
    result->status = static_cast<uint32_t>(snapshot.status);
    result->revision_low = static_cast<uint32_t>(snapshot.revision);
    result->revision_high = static_cast<uint32_t>(snapshot.revision >> 32);
    result->cursor_byte_offset = snapshot.cursor_byte_offset;
    result->text_length = static_cast<uint32_t>(owner->text.size());
    result->text_ptr = reinterpret_cast<const uint8_t*>(owner->text.data());
    result->message_length = static_cast<uint32_t>(owner->message.size());
    result->message_ptr = reinterpret_cast<const uint8_t*>(owner->message.data());
    result->action = snapshot.action;
    result->owner_ptr = owner.release();
    return result->status;
}

uint32_t StoreTerminalResult(DashQLShellTerminalResult* result,
                             dashql::shell::ShellOperation output,
                             dashql::shell::PromptInputAction action = dashql::shell::PromptInputAction::kNone) {
    if (output.data.size() > std::numeric_limits<uint32_t>::max()) {
        output.status = dashql::shell::ShellStatus::kInternalError;
        output.data = "terminal output exceeds the C ABI size limit";
    }
    auto owner = std::make_unique<std::string>(std::move(output.data));
    result->status = static_cast<uint32_t>(output.status);
    result->action = static_cast<uint32_t>(action);
    result->data_length = static_cast<uint32_t>(owner->size());
    result->data_ptr = reinterpret_cast<const uint8_t*>(owner->data());
    result->owner_ptr = owner.release();
    return result->status;
}

uint32_t StoreCompletionResult(DashQLShellCompletionResult* result,
                               std::vector<dashql::shell::CompletionCandidate> candidates) {
    if (candidates.size() > std::numeric_limits<uint32_t>::max()) {
        return DASHQL_SHELL_INTERNAL_ERROR;
    }
    auto owner = std::make_unique<CompletionResultOwner>();
    owner->source = std::move(candidates);
    owner->ffi.reserve(owner->source.size());
    for (const auto& candidate : owner->source) {
        owner->ffi.push_back({
            .display_text_length = static_cast<uint32_t>(candidate.display_text.size()),
            .display_text_ptr = reinterpret_cast<const uint8_t*>(candidate.display_text.data()),
            .completion_text_length = static_cast<uint32_t>(candidate.completion_text.size()),
            .completion_text_ptr = reinterpret_cast<const uint8_t*>(candidate.completion_text.data()),
            .target_offset = candidate.target_offset,
            .target_length = candidate.target_length,
        });
    }
    result->count = static_cast<uint32_t>(owner->ffi.size());
    result->candidates_ptr = owner->ffi.data();
    result->owner_ptr = owner.release();
    return DASHQL_SHELL_OK;
}

uint64_t ReadEffectId(uint32_t low, uint32_t high) {
    return static_cast<uint64_t>(low) | (static_cast<uint64_t>(high) << 32);
}

template <typename Callback>
uint32_t InvokePrompt(DashQLShell* shell, DashQLShellPromptResult* result, Callback callback) {
    if (result == nullptr) {
        return DASHQL_SHELL_INVALID_ARGUMENT;
    }
    ResetPromptResult(result);
    if (shell == nullptr) {
        return StorePromptResult(result, {dashql::shell::ShellStatus::kInvalidArgument, 0, 0, {}, "invalid shell"});
    }
    try {
        return StorePromptResult(result, callback(shell->session));
    } catch (const std::exception& error) {
        return StorePromptResult(result, {dashql::shell::ShellStatus::kInternalError, 0, 0, {}, error.what()});
    } catch (...) {
        return StorePromptResult(result,
                                 {dashql::shell::ShellStatus::kInternalError, 0, 0, {}, "unknown shell prompt error"});
    }
}

template <typename Callback>
uint32_t InvokeTerminal(DashQLShell* shell, DashQLShellTerminalResult* result, Callback callback) {
    if (result == nullptr) return DASHQL_SHELL_INVALID_ARGUMENT;
    ResetTerminalResult(result);
    if (shell == nullptr) {
        return StoreTerminalResult(result, {dashql::shell::ShellStatus::kInvalidArgument, "invalid shell"});
    }
    try {
        auto output = callback(shell->session);
        const auto action = shell->session.terminal_action();
        return StoreTerminalResult(result, std::move(output), action);
    } catch (const std::exception& error) {
        return StoreTerminalResult(result, {dashql::shell::ShellStatus::kInternalError, error.what()});
    } catch (...) {
        return StoreTerminalResult(result,
                                   {dashql::shell::ShellStatus::kInternalError, "unknown shell terminal error"});
    }
}

}  // namespace

extern "C" {

DashQLShell* dashql_shell_new(dashql::Catalog* catalog, uint32_t terminal_columns) {
    if (catalog == nullptr) {
        return nullptr;
    }
    try {
        return new DashQLShell{*catalog, terminal_columns};
    } catch (...) {
        return nullptr;
    }
}

void dashql_shell_destroy(DashQLShell* shell) {
    delete shell;
}

void dashql_shell_resize(DashQLShell* shell, uint32_t terminal_columns) {
    if (shell != nullptr) {
        shell->session.Resize(terminal_columns);
    }
}

uint32_t dashql_shell_commands_set(DashQLShell* shell, const uint8_t* commands, size_t commands_length) {
    if (shell == nullptr || (commands == nullptr && commands_length != 0)) {
        return DASHQL_SHELL_INVALID_ARGUMENT;
    }
    return static_cast<uint32_t>(
        shell->session.SetCommands({reinterpret_cast<const char*>(commands), commands_length}));
}

uint32_t dashql_shell_prompt_set(DashQLShell* shell,
                                 const uint8_t* text,
                                 size_t text_length,
                                 DashQLShellPromptResult* result) {
    if (text == nullptr && text_length != 0) {
        if (result == nullptr) return DASHQL_SHELL_INVALID_ARGUMENT;
        ResetPromptResult(result);
        return StorePromptResult(result,
                                 {dashql::shell::ShellStatus::kInvalidArgument, 0, 0, {}, "invalid prompt buffer"});
    }
    return InvokePrompt(shell, result, [=](auto& session) {
        return session.SetPrompt({reinterpret_cast<const char*>(text), text_length});
    });
}

uint32_t dashql_shell_prompt_insert(DashQLShell* shell,
                                    const uint8_t* text,
                                    size_t text_length,
                                    DashQLShellPromptResult* result) {
    if (text == nullptr && text_length != 0) {
        if (result == nullptr) return DASHQL_SHELL_INVALID_ARGUMENT;
        ResetPromptResult(result);
        return StorePromptResult(result,
                                 {dashql::shell::ShellStatus::kInvalidArgument, 0, 0, {}, "invalid prompt buffer"});
    }
    return InvokePrompt(shell, result, [=](auto& session) {
        return session.InsertPrompt({reinterpret_cast<const char*>(text), text_length});
    });
}

uint32_t dashql_shell_prompt_move_left(DashQLShell* shell, DashQLShellPromptResult* result) {
    return InvokePrompt(shell, result, [](auto& session) { return session.MovePromptLeft(); });
}

uint32_t dashql_shell_prompt_move_right(DashQLShell* shell, DashQLShellPromptResult* result) {
    return InvokePrompt(shell, result, [](auto& session) { return session.MovePromptRight(); });
}

uint32_t dashql_shell_prompt_delete_backward(DashQLShell* shell, DashQLShellPromptResult* result) {
    return InvokePrompt(shell, result, [](auto& session) { return session.DeletePromptBackward(); });
}

uint32_t dashql_shell_prompt_delete_forward(DashQLShell* shell, DashQLShellPromptResult* result) {
    return InvokePrompt(shell, result, [](auto& session) { return session.DeletePromptForward(); });
}

uint32_t dashql_shell_prompt_complete(DashQLShell* shell, size_t limit, DashQLShellCompletionResult* result) {
    if (result == nullptr) {
        return DASHQL_SHELL_INVALID_ARGUMENT;
    }
    ResetCompletionResult(result);
    if (shell == nullptr) {
        return DASHQL_SHELL_INVALID_ARGUMENT;
    }
    try {
        return StoreCompletionResult(result, shell->session.CompletePrompt(limit));
    } catch (...) {
        return DASHQL_SHELL_INTERNAL_ERROR;
    }
}

uint32_t dashql_shell_prompt_apply_completion(DashQLShell* shell,
                                              const DashQLShellCompletionCandidate* candidate,
                                              DashQLShellPromptResult* result) {
    if (candidate == nullptr ||
        (candidate->display_text_ptr == nullptr && candidate->display_text_length != 0) ||
        (candidate->completion_text_ptr == nullptr && candidate->completion_text_length != 0)) {
        if (result == nullptr) return DASHQL_SHELL_INVALID_ARGUMENT;
        ResetPromptResult(result);
        return StorePromptResult(result,
                                 {dashql::shell::ShellStatus::kInvalidArgument, 0, 0, {}, "invalid completion"});
    }
    const dashql::shell::CompletionCandidate completion{
        .display_text = std::string{reinterpret_cast<const char*>(candidate->display_text_ptr),
                                    candidate->display_text_length},
        .completion_text = std::string{reinterpret_cast<const char*>(candidate->completion_text_ptr),
                                       candidate->completion_text_length},
        .continuation_text = {},
        .is_identity = false,
        .qualification_texts = {},
        .completion_cursor_offset = candidate->completion_text_length,
        .target_offset = candidate->target_offset,
        .target_length = candidate->target_length,
        .qualification_target_offset = candidate->target_offset,
        .qualification_target_length = candidate->target_length,
    };
    return InvokePrompt(shell, result, [&](auto& session) { return session.ApplyCompletion(completion); });
}

uint32_t dashql_shell_prompt_consume(DashQLShell* shell,
                                     uint32_t key,
                                     const uint8_t* text,
                                     size_t text_length,
                                     DashQLShellPromptResult* result) {
    if (key > DASHQL_SHELL_INPUT_END || (text == nullptr && text_length != 0)) {
        if (result == nullptr) return DASHQL_SHELL_INVALID_ARGUMENT;
        ResetPromptResult(result);
        return StorePromptResult(result,
                                 {dashql::shell::ShellStatus::kInvalidArgument, 0, 0, {}, "invalid prompt input"});
    }
    const std::string_view input{reinterpret_cast<const char*>(text), text_length};
    return InvokePrompt(shell, result, [=](auto& session) {
        return session.ConsumePromptInput(static_cast<dashql::shell::PromptInputKey>(key), input);
    });
}

uint32_t dashql_shell_prompt_submit(DashQLShell* shell, DashQLShellResult* result) {
    if (result == nullptr) {
        return DASHQL_SHELL_INVALID_ARGUMENT;
    }
    ResetResult(result);
    if (shell == nullptr) {
        return StoreResult(result, DASHQL_SHELL_INVALID_ARGUMENT, "invalid shell");
    }
    try {
        return StoreOperation(result, shell->session.SubmitPrompt());
    } catch (const std::exception& error) {
        return StoreResult(result, DASHQL_SHELL_INTERNAL_ERROR, error.what());
    } catch (...) {
        return StoreResult(result, DASHQL_SHELL_INTERNAL_ERROR, "unknown shell submit error");
    }
}

void dashql_shell_prompt_result_destroy(DashQLShellPromptResult* result) {
    if (result == nullptr) return;
    delete static_cast<PromptResultOwner*>(result->owner_ptr);
    ResetPromptResult(result);
}

void dashql_shell_completion_result_destroy(DashQLShellCompletionResult* result) {
    if (result == nullptr) return;
    delete static_cast<CompletionResultOwner*>(result->owner_ptr);
    ResetCompletionResult(result);
}

uint32_t dashql_shell_terminal_open(DashQLShell* shell,
                                    const uint8_t* prompt,
                                    size_t prompt_length,
                                    bool welcome,
                                    DashQLShellTerminalResult* result) {
    if (prompt == nullptr && prompt_length != 0) {
        if (result == nullptr) return DASHQL_SHELL_INVALID_ARGUMENT;
        ResetTerminalResult(result);
        return StoreTerminalResult(result,
                                   {dashql::shell::ShellStatus::kInvalidArgument, "invalid terminal prompt"});
    }
    const std::string_view value{reinterpret_cast<const char*>(prompt), prompt_length};
    return InvokeTerminal(shell, result, [=](auto& session) { return session.OpenTerminal(value, welcome); });
}

uint32_t dashql_shell_terminal_consume(DashQLShell* shell,
                                       uint32_t key,
                                       const uint8_t* text,
                                       size_t text_length,
                                       DashQLShellTerminalResult* result) {
    if (key > DASHQL_SHELL_INPUT_END || (text == nullptr && text_length != 0)) {
        if (result == nullptr) return DASHQL_SHELL_INVALID_ARGUMENT;
        ResetTerminalResult(result);
        return StoreTerminalResult(result,
                                   {dashql::shell::ShellStatus::kInvalidArgument, "invalid terminal input"});
    }
    const std::string_view value{reinterpret_cast<const char*>(text), text_length};
    return InvokeTerminal(shell, result, [=](auto& session) {
        return session.ConsumeTerminalInput(static_cast<dashql::shell::PromptInputKey>(key), value);
    });
}

uint32_t dashql_shell_terminal_finish_query(DashQLShell* shell,
                                            const uint8_t* output,
                                            size_t output_length,
                                            bool error,
                                            DashQLShellTerminalResult* result) {
    if (output == nullptr && output_length != 0) {
        if (result == nullptr) return DASHQL_SHELL_INVALID_ARGUMENT;
        ResetTerminalResult(result);
        return StoreTerminalResult(result,
                                   {dashql::shell::ShellStatus::kInvalidArgument, "invalid terminal query output"});
    }
    const std::string_view value{reinterpret_cast<const char*>(output), output_length};
    return InvokeTerminal(shell, result, [=](auto& session) { return session.FinishTerminalQuery(value, error); });
}

uint32_t dashql_shell_terminal_status(DashQLShell* shell,
                                      const uint8_t* message,
                                      size_t message_length,
                                      DashQLShellTerminalResult* result) {
    if (message == nullptr && message_length != 0) {
        if (result == nullptr) return DASHQL_SHELL_INVALID_ARGUMENT;
        ResetTerminalResult(result);
        return StoreTerminalResult(result,
                                   {dashql::shell::ShellStatus::kInvalidArgument, "invalid terminal status"});
    }
    const std::string_view value{reinterpret_cast<const char*>(message), message_length};
    return InvokeTerminal(shell, result, [=](auto& session) { return session.RenderTerminalStatus(value); });
}

void dashql_shell_terminal_result_destroy(DashQLShellTerminalResult* result) {
    if (result == nullptr) return;
    delete static_cast<std::string*>(result->owner_ptr);
    ResetTerminalResult(result);
}

uint32_t dashql_shell_history_export(DashQLShell* shell, DashQLShellResult* result) {
    if (result == nullptr) return DASHQL_SHELL_INVALID_ARGUMENT;
    ResetResult(result);
    if (shell == nullptr) return StoreResult(result, DASHQL_SHELL_INVALID_ARGUMENT, "invalid shell");
    try {
        return StoreResult(result, DASHQL_SHELL_OK, shell->session.ExportHistory());
    } catch (const std::exception& error) {
        return StoreResult(result, DASHQL_SHELL_INTERNAL_ERROR, error.what());
    }
}

uint32_t dashql_shell_history_import(DashQLShell* shell,
                                     const uint8_t* data,
                                     size_t data_length,
                                     DashQLShellResult* result) {
    if (result == nullptr) return DASHQL_SHELL_INVALID_ARGUMENT;
    ResetResult(result);
    if (shell == nullptr || (data == nullptr && data_length != 0)) {
        return StoreResult(result, DASHQL_SHELL_INVALID_ARGUMENT, "invalid history");
    }
    try {
        const auto status = shell->session.ImportHistory(std::span<const uint8_t>{data, data_length});
        return StoreResult(result, static_cast<uint32_t>(status), {});
    } catch (const std::exception& error) {
        return StoreResult(result, DASHQL_SHELL_INTERNAL_ERROR, error.what());
    }
}

uint32_t dashql_shell_start_query(DashQLShell* shell,
                                  const uint8_t* query,
                                  size_t query_length,
                                  DashQLShellResult* result) {
    if (result == nullptr) {
        return DASHQL_SHELL_INVALID_ARGUMENT;
    }
    ResetResult(result);
    if (shell == nullptr || (query == nullptr && query_length != 0)) {
        return StoreResult(result, DASHQL_SHELL_INVALID_ARGUMENT, "invalid shell or query buffer");
    }
    try {
        const std::string_view query_text{reinterpret_cast<const char*>(query), query_length};
        return StoreOperation(result, shell->session.StartQuery(query_text));
    } catch (const std::exception& error) {
        return StoreResult(result, DASHQL_SHELL_INTERNAL_ERROR, error.what());
    } catch (...) {
        return StoreResult(result, DASHQL_SHELL_INTERNAL_ERROR, "unknown shell query error");
    }
}

uint32_t dashql_shell_complete_effect(DashQLShell* shell,
                                      uint32_t effect_id_low,
                                      uint32_t effect_id_high,
                                      uint32_t completion_status,
                                      const uint8_t* data,
                                      size_t data_length,
                                      DashQLShellResult* result) {
    if (result == nullptr) {
        return DASHQL_SHELL_INVALID_ARGUMENT;
    }
    ResetResult(result);
    if (shell == nullptr || (data == nullptr && data_length != 0) ||
        completion_status > DASHQL_SHELL_EFFECT_CANCELLED) {
        return StoreResult(result, DASHQL_SHELL_INVALID_ARGUMENT, "invalid effect completion");
    }
    try {
        const auto status = static_cast<dashql::shell::EffectCompletionStatus>(completion_status);
        return StoreOperation(result,
                              shell->session.CompleteEffect(ReadEffectId(effect_id_low, effect_id_high), status,
                                                            std::span<const uint8_t>{data, data_length}));
    } catch (const std::exception& error) {
        return StoreResult(result, DASHQL_SHELL_INTERNAL_ERROR, error.what());
    } catch (...) {
        return StoreResult(result, DASHQL_SHELL_INTERNAL_ERROR, "unknown shell completion error");
    }
}

uint32_t dashql_shell_cancel_effect(DashQLShell* shell,
                                    uint32_t effect_id_low,
                                    uint32_t effect_id_high,
                                    DashQLShellResult* result) {
    if (result == nullptr) {
        return DASHQL_SHELL_INVALID_ARGUMENT;
    }
    ResetResult(result);
    if (shell == nullptr) {
        return StoreResult(result, DASHQL_SHELL_INVALID_ARGUMENT, "invalid shell");
    }
    try {
        return StoreOperation(result, shell->session.CancelEffect(ReadEffectId(effect_id_low, effect_id_high)));
    } catch (const std::exception& error) {
        return StoreResult(result, DASHQL_SHELL_INTERNAL_ERROR, error.what());
    } catch (...) {
        return StoreResult(result, DASHQL_SHELL_INTERNAL_ERROR, "unknown shell cancellation error");
    }
}

void dashql_shell_result_destroy(DashQLShellResult* result) {
    if (result == nullptr) {
        return;
    }
    delete static_cast<std::string*>(result->owner_ptr);
    ResetResult(result);
}

}
