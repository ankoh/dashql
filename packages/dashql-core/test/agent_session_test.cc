#include "dashql/agent/agent_session.h"

#include "dashql/catalog.h"
#include "gtest/gtest.h"

using namespace dashql;
using namespace dashql::agent;
using namespace dashql::buffers::agent;

namespace {

// These tests exercise the public suspension protocol rather than coroutine internals.

AgentEffectCompletionT CompleteContext(const AgentOperationT& operation, std::string context = {},
                                       AgentTargetKind target_kind = AgentTargetKind::NONE,
                                       std::string target_name = {}) {
    AgentEffectCompletionT completion;
    completion.effect_id = operation.effect->id;
    completion.context = std::make_unique<AgentContextResultT>();
    completion.context->context = std::move(context);
    completion.context->target_kind = target_kind;
    completion.context->target_name = std::move(target_name);
    return completion;
}

AgentEffectCompletionT CompleteModel(const AgentOperationT& operation, std::string text) {
    AgentEffectCompletionT completion;
    completion.effect_id = operation.effect->id;
    completion.model = std::make_unique<AgentModelCompletionT>();
    completion.model->text = std::move(text);
    return completion;
}

AgentEffectCompletionT CompleteTranscode(const AgentOperationT& operation, std::string candidate,
                                         std::vector<std::string> errors = {}) {
    AgentEffectCompletionT completion;
    completion.effect_id = operation.effect->id;
    completion.transcode_vegalite = std::make_unique<AgentTranscodeVegaLiteResultT>();
    completion.transcode_vegalite->candidate_text = std::move(candidate);
    completion.transcode_vegalite->errors = std::move(errors);
    return completion;
}

AgentEffectCompletionT CompleteApply(const AgentOperationT& operation) {
    AgentEffectCompletionT completion;
    completion.effect_id = operation.effect->id;
    completion.apply = std::make_unique<AgentApplyResultT>();
    completion.apply->applied = true;
    return completion;
}

AgentEffectCompletionT RejectApply(const AgentOperationT& operation) {
    AgentEffectCompletionT completion;
    completion.effect_id = operation.effect->id;
    completion.apply = std::make_unique<AgentApplyResultT>();
    return completion;
}

AgentOperationT StartWithIntent(AgentSession& session, AgentIntent intent, uint32_t max_attempts = 3) {
    AgentStartRequestT request;
    request.user_prompt = "do the thing";
    request.intent_override = intent;
    request.max_attempts = max_attempts;
    request.read_only = true;
    return session.Start(request);
}

TEST(AgentSessionTest, CleanSqlProducesApplyProposalAndSucceeds) {
    Catalog catalog;
    AgentSession session{catalog};
    auto operation = StartWithIntent(session, AgentIntent::SQL);
    ASSERT_EQ(operation.status, AgentStatus::PENDING);
    ASSERT_EQ(operation.effect->type, AgentEffectType::RESOLVE_CONTEXT);

    operation = session.CompleteEffect(CompleteContext(operation, "schema context"));
    ASSERT_EQ(operation.effect->model_request->kind, AgentModelRequestKind::GENERATE);
    EXPECT_EQ(operation.effect->model_request->context, "schema context");

    operation = session.CompleteEffect(CompleteModel(operation, "```sql\nselect 1\n```"));
    ASSERT_EQ(operation.effect->type, AgentEffectType::APPLY_PROPOSAL);
    ASSERT_NE(operation.effect->apply_proposal->proposal, nullptr);
    EXPECT_EQ(operation.effect->apply_proposal->proposal->candidate_text, "select 1");
    EXPECT_TRUE(operation.effect->apply_proposal->proposal->verify_result->parser_errors.empty());

    operation = session.CompleteEffect(CompleteApply(operation));
    ASSERT_NE(operation.snapshot, nullptr);
    EXPECT_EQ(operation.snapshot->phase, AgentPhase::SUCCEEDED);
    ASSERT_EQ(operation.events.size(), 1u);
    EXPECT_EQ(operation.events[0]->type, AgentEventType::SUCCEEDED);
}

TEST(AgentSessionTest, ApplyAcknowledgementMustConfirmApplication) {
    Catalog catalog;
    AgentSession session{catalog};
    auto operation = StartWithIntent(session, AgentIntent::SQL);
    operation = session.CompleteEffect(CompleteContext(operation));
    operation = session.CompleteEffect(CompleteModel(operation, "select 1"));
    operation = session.CompleteEffect(RejectApply(operation));
    EXPECT_EQ(operation.status, AgentStatus::OK);
    EXPECT_EQ(operation.snapshot->phase, AgentPhase::FAILED);
    ASSERT_EQ(operation.events.size(), 1u);
    EXPECT_EQ(operation.events[0]->message, "the proposal was not applied");
}

struct ApplyDispositionCase {
    AgentIntent intent;
    AgentTargetKind target_kind;
    AgentApplyDisposition expected;
};

class ApplyDispositionTest : public testing::TestWithParam<ApplyDispositionCase> {};

TEST_P(ApplyDispositionTest, CoreChoosesApplyDispositionFromIntentAndTarget) {
    Catalog catalog;
    AgentSession session{catalog};
    const auto& param = GetParam();

    auto operation = StartWithIntent(session, param.intent);
    operation = session.CompleteEffect(CompleteContext(operation, {}, param.target_kind, "target.sql"));
    operation = session.CompleteEffect(CompleteModel(
        operation, param.intent == AgentIntent::SQL ? "select 1" : "{\"mark\":\"bar\"}"));
    if (param.intent == AgentIntent::VISUALIZE) {
        operation = session.CompleteEffect(CompleteTranscode(
            operation, "select 1 visualize using vegalite (mark => bar)"));
    }

    ASSERT_EQ(operation.effect->apply_proposal->proposal->disposition, param.expected);
    if (param.expected == AgentApplyDisposition::REPLACE) {
        EXPECT_EQ(operation.effect->apply_proposal->proposal->target_name, "target.sql");
    } else {
        EXPECT_TRUE(operation.effect->apply_proposal->proposal->target_name.empty());
    }
}

INSTANTIATE_TEST_SUITE_P(
    DecisionTable, ApplyDispositionTest,
    testing::Values(
        ApplyDispositionCase{AgentIntent::SQL, AgentTargetKind::NONE, AgentApplyDisposition::CREATE},
        ApplyDispositionCase{AgentIntent::SQL, AgentTargetKind::SQL, AgentApplyDisposition::REPLACE},
        ApplyDispositionCase{AgentIntent::SQL, AgentTargetKind::VISUALIZATION, AgentApplyDisposition::REPLACE},
        ApplyDispositionCase{AgentIntent::VISUALIZE, AgentTargetKind::NONE, AgentApplyDisposition::CREATE},
        ApplyDispositionCase{AgentIntent::VISUALIZE, AgentTargetKind::SQL, AgentApplyDisposition::CREATE},
        ApplyDispositionCase{AgentIntent::VISUALIZE, AgentTargetKind::VISUALIZATION,
                             AgentApplyDisposition::REPLACE}));

TEST(AgentSessionTest, ParserErrorsDriveRepairAndExhaustion) {
    Catalog catalog;
    AgentSession session{catalog};
    auto operation = StartWithIntent(session, AgentIntent::SQL, 2);
    operation = session.CompleteEffect(CompleteContext(operation));
    operation = session.CompleteEffect(CompleteModel(operation, "select ("));

    ASSERT_EQ(operation.snapshot->phase, AgentPhase::REPAIRING);
    ASSERT_EQ(operation.effect->model_request->kind, AgentModelRequestKind::REPAIR);
    ASSERT_FALSE(operation.effect->model_request->errors.empty());
    EXPECT_EQ(operation.effect->model_request->previous_candidate, "select (");

    operation = session.CompleteEffect(CompleteModel(operation, "select ("));
    EXPECT_EQ(operation.snapshot->phase, AgentPhase::FAILED);
    ASSERT_FALSE(operation.events.empty());
    EXPECT_EQ(operation.events.back()->type, AgentEventType::FAILED);
    EXPECT_TRUE(operation.events.back()->expected_failure);
    EXPECT_EQ(operation.snapshot->attempt, 2u);
}

TEST(AgentSessionTest, EmptySqlIsRepairable) {
    Catalog catalog;
    AgentSession session{catalog};
    auto operation = StartWithIntent(session, AgentIntent::SQL);
    operation = session.CompleteEffect(CompleteContext(operation));
    operation = session.CompleteEffect(CompleteModel(operation, "   "));

    ASSERT_EQ(operation.effect->model_request->kind, AgentModelRequestKind::REPAIR);
    ASSERT_EQ(operation.effect->model_request->errors.size(), 1u);
    EXPECT_EQ(operation.effect->model_request->errors[0], "The model returned an empty result.");
}

TEST(AgentSessionTest, VisualizationUsesTranscodeEffectAndRequiresVisualizationSpec) {
    Catalog catalog;
    AgentSession session{catalog};
    auto operation = StartWithIntent(session, AgentIntent::VISUALIZE);
    operation = session.CompleteEffect(CompleteContext(operation));
    operation = session.CompleteEffect(CompleteModel(operation, "before {\"mark\":\"bar\"} after"));
    ASSERT_EQ(operation.effect->type, AgentEffectType::TRANSCODE_VEGALITE);
    EXPECT_EQ(operation.effect->transcode_vegalite->raw_spec_json, "{\"mark\":\"bar\"}");

    operation = session.CompleteEffect(CompleteTranscode(operation, "select 1"));
    ASSERT_EQ(operation.effect->model_request->kind, AgentModelRequestKind::REPAIR);
    ASSERT_FALSE(operation.effect->model_request->errors.empty());
    EXPECT_EQ(operation.effect->model_request->errors[0],
              "The statement did not resolve into a visualization. Check the source and channels.");
}

TEST(AgentSessionTest, ClassificationDefaultsAmbiguousOutputToSql) {
    Catalog catalog;
    AgentSession session{catalog};
    AgentStartRequestT request;
    request.user_prompt = "do something";
    request.max_attempts = 3;
    auto operation = session.Start(request);
    ASSERT_EQ(operation.effect->model_request->kind, AgentModelRequestKind::CLASSIFY);

    operation = session.CompleteEffect(CompleteModel(operation, "maybe"));
    ASSERT_EQ(operation.effect->type, AgentEffectType::RESOLVE_CONTEXT);
    EXPECT_EQ(operation.effect->resolve_context->intent, AgentIntent::SQL);
}

TEST(AgentSessionTest, CancellationAndStaleCompletionsAreExplicit) {
    Catalog catalog;
    AgentSession session{catalog};
    auto operation = StartWithIntent(session, AgentIntent::SQL);
    const auto stale = CompleteContext(operation);

    operation = session.Cancel();
    EXPECT_EQ(operation.snapshot->phase, AgentPhase::CANCELLED);

    operation = session.CompleteEffect(stale);
    EXPECT_EQ(operation.status, AgentStatus::STALE_EFFECT);
}

TEST(AgentSessionTest, MissingCompletionPayloadDoesNotConsumeEffect) {
    Catalog catalog;
    AgentSession session{catalog};
    auto operation = StartWithIntent(session, AgentIntent::SQL);
    const auto effect_id = operation.effect->id;

    AgentEffectCompletionT missing;
    missing.effect_id = effect_id;
    operation = session.CompleteEffect(missing);
    EXPECT_EQ(operation.status, AgentStatus::INVALID_ARGUMENT);

    AgentEffectCompletionT valid;
    valid.effect_id = effect_id;
    valid.context = std::make_unique<AgentContextResultT>();
    operation = session.CompleteEffect(valid);
    EXPECT_EQ(operation.status, AgentStatus::PENDING);
    ASSERT_NE(operation.effect, nullptr);
    EXPECT_EQ(operation.effect->model_request->kind, AgentModelRequestKind::GENERATE);
}

TEST(AgentSessionTest, TerminalSessionCanRestartAndCancel) {
    Catalog catalog;
    AgentSession session{catalog};
    auto operation = StartWithIntent(session, AgentIntent::SQL);
    operation = session.Cancel();
    ASSERT_EQ(operation.snapshot->phase, AgentPhase::CANCELLED);

    operation = StartWithIntent(session, AgentIntent::SQL);
    ASSERT_EQ(operation.status, AgentStatus::PENDING);
    EXPECT_EQ(operation.snapshot->phase, AgentPhase::IDLE);
    operation = session.Cancel();
    EXPECT_EQ(operation.snapshot->phase, AgentPhase::CANCELLED);
}

TEST(AgentSessionTest, RejectsMutatingAndMultiStatementSql) {
    Catalog catalog;
    AgentSession session{catalog};
    auto operation = StartWithIntent(session, AgentIntent::SQL);
    operation = session.CompleteEffect(CompleteContext(operation));
    operation = session.CompleteEffect(CompleteModel(operation, "create table x (a int)"));
    ASSERT_EQ(operation.snapshot->phase, AgentPhase::REPAIRING);
    EXPECT_EQ(operation.effect->model_request->errors[0],
              "The generated SQL must be a read-only SELECT statement.");
}

TEST(AgentSessionTest, ModelAndApplyEffectErrorsFinishTheCoroutine) {
    Catalog catalog;
    AgentSession session{catalog};
    auto operation = StartWithIntent(session, AgentIntent::SQL);
    operation = session.CompleteEffect(CompleteContext(operation));

    AgentEffectCompletionT failed;
    failed.effect_id = operation.effect->id;
    failed.status = AgentEffectCompletionStatus::ERROR;
    failed.error = "provider unavailable";
    operation = session.CompleteEffect(failed);
    ASSERT_EQ(operation.snapshot->phase, AgentPhase::FAILED);
    ASSERT_EQ(operation.events.size(), 1u);
    EXPECT_FALSE(operation.events[0]->expected_failure);
    EXPECT_EQ(operation.events[0]->message, "provider unavailable");

    operation = StartWithIntent(session, AgentIntent::SQL);
    operation = session.CompleteEffect(CompleteContext(operation));
    operation = session.CompleteEffect(CompleteModel(operation, "select 1"));
    ASSERT_EQ(operation.effect->type, AgentEffectType::APPLY_PROPOSAL);
    failed.effect_id = operation.effect->id;
    failed.error = "apply failed";
    operation = session.CompleteEffect(failed);
    EXPECT_EQ(operation.snapshot->phase, AgentPhase::FAILED);
    EXPECT_EQ(operation.events[0]->message, "apply failed");
}

TEST(AgentSessionTest, CancellationWorksAtModelAndApplySuspensionPoints) {
    Catalog catalog;
    AgentSession session{catalog};
    auto operation = StartWithIntent(session, AgentIntent::SQL);
    operation = session.CompleteEffect(CompleteContext(operation));
    operation = session.Cancel();
    EXPECT_EQ(operation.snapshot->phase, AgentPhase::CANCELLED);

    operation = StartWithIntent(session, AgentIntent::SQL);
    operation = session.CompleteEffect(CompleteContext(operation));
    operation = session.CompleteEffect(CompleteModel(operation, "select 1"));
    ASSERT_EQ(operation.effect->type, AgentEffectType::APPLY_PROPOSAL);
    operation = session.Cancel();
    EXPECT_EQ(operation.snapshot->phase, AgentPhase::CANCELLED);
}

}  // namespace
