# MiniMax Report Evaluator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MiniMax model configuration and a saved large-model evaluation result for generated summary reports.

**Architecture:** Store MiniMax credentials through the existing secure config flow. Add a focused report evaluator service that extracts summary report data, calls the MiniMax OpenAI-compatible chat completion endpoint, normalizes JSON output, and saves results locally by report run ID. Render the evaluation as a report-page section with manual trigger and non-blocking errors.

**Tech Stack:** React, local secure config store, backend config repository, browser `fetch`, Node `.mjs` tests.

## Global Constraints

- MiniMax API key is sensitive and must be masked/encrypted by the existing config store.
- Default MiniMax endpoint uses the OpenAI-compatible `https://api.minimax.io/v1/chat/completions`.
- Large-model evaluation failure must not block original summary report viewing or export.
- Evaluation result must include score, risk level, release suggestion, summary, main problems, and suggestions.
- Test failures/errors should increase risk level through deterministic normalization.

---

### Task 1: MiniMax Secure Config

**Files:**
- Modify: `src/modules/config/secureConfigStore.js`
- Modify: `src/components/ConfigCenter.jsx`
- Modify: `server/configRepository.js`
- Test: `tests/minimaxConfig.test.mjs`

**Interfaces:**
- Produces: `CONFIG_TYPES.MINIMAX`, `CONFIG_SCHEMAS[CONFIG_TYPES.MINIMAX]`

- [x] Write failing config test for masked MiniMax API key and complete status.
- [x] Run `node tests/minimaxConfig.test.mjs` and verify it fails because `CONFIG_TYPES.MINIMAX` is missing.
- [x] Add MiniMax schema, config tab, field labels/order, and backend valid config type.
- [x] Run `node tests/minimaxConfig.test.mjs` and verify it passes.

### Task 2: Report Evaluator Service

**Files:**
- Create: `src/services/reportEvaluatorService.js`
- Test: `tests/reportEvaluatorService.test.mjs`

**Interfaces:**
- Produces: `buildEvaluationInput(report)`, `evaluateReportWithMiniMax(report, options)`, `getSavedEvaluationResult(runId, options)`

- [x] Write failing service tests for summary extraction, MiniMax request, JSON parsing, persistence, and high-risk normalization.
- [x] Run `node tests/reportEvaluatorService.test.mjs` and verify it fails because the service does not exist.
- [x] Implement the evaluator service with storage and safe error handling.
- [x] Run `node tests/reportEvaluatorService.test.mjs` and verify it passes.

### Task 3: Report Page Integration

**Files:**
- Modify: `src/components/SummaryReport.jsx`

**Interfaces:**
- Consumes: `evaluateReportWithMiniMax(report)`, `getSavedEvaluationResult(runId)`

- [x] Add a report-page evaluation panel with trigger button and saved result loading.
- [x] Show score, risk, release suggestion, summary, main problems, and suggestions.
- [x] Show non-blocking error text when the MiniMax call fails.
- [x] Run the full `.mjs` test suite and `npm run build`.
