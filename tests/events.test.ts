import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOpencodeEvents } from "../src/backends/opencode/events.js";

const SAMPLE_NDJSON = [
  '{"type":"step_start","timestamp":1785174485749,"sessionID":"ses_05b4f2f9bffeo8a7lOYpoyaMES","part":{"id":"prt_fa4b0eae9001z1qcXeLKQdEfrS","messageID":"msg_fa4b0d0e500111Qp6p17m694hd","sessionID":"ses_05b4f2f9bffeo8a7lOYpoyaMES","type":"step-start"}}',
  '{"type":"text","timestamp":1785174486405,"sessionID":"ses_05b4f2f9bffeo8a7lOYpoyaMES","part":{"id":"prt_fa4b0ed53001aJEMK15ByLkzfQ","messageID":"msg_fa4b0d0e500111Qp6p17m694hd","sessionID":"ses_05b4f2f9bffeo8a7lOYpoyaMES","type":"text","text":"PONG","time":{"start":1785174486355,"end":1785174486388}}}',
  '{"type":"step_finish","timestamp":1785174486405,"sessionID":"ses_05b4f2f9bffeo8a7lOYpoyaMES","part":{"id":"prt_fa4b0ed78001oey7ntbj1WP6VC","reason":"stop","messageID":"msg_fa4b0d0e500111Qp6p17m694hd","sessionID":"ses_05b4f2f9bffeo8a7lOYpoyaMES","type":"step-finish","tokens":{"total":7138,"input":7093,"output":4,"reasoning":41,"cache":{"write":0,"read":0}},"cost":0.00691835}}',
  "",
].join("\n");

test("parses a real captured opencode event stream", () => {
  const result = parseOpencodeEvents(SAMPLE_NDJSON);
  assert.equal(result.output, "PONG");
  assert.equal(result.summary, "PONG");
  assert.equal(result.sessionId, "ses_05b4f2f9bffeo8a7lOYpoyaMES");
  assert.equal(result.hasTerminalEvent, true);
  assert.deepEqual(result.tokens, {
    total: 7138,
    input: 7093,
    output: 4,
    reasoning: 41,
    cache: { write: 0, read: 0 },
  });
  assert.equal(result.cost, 0.00691835);
});

test("concatenates multiple text parts in order", () => {
  const ndjson = [
    '{"type":"text","sessionID":"ses_x","part":{"type":"text","text":"Hello, "}}',
    '{"type":"text","sessionID":"ses_x","part":{"type":"text","text":"world."}}',
  ].join("\n");
  const result = parseOpencodeEvents(ndjson);
  assert.equal(result.output, "Hello, world.");
});

test("finalText is the last text block (the answer), not the whole transcript", () => {
  const ndjson = [
    '{"type":"text","sessionID":"ses_x","part":{"type":"text","text":"Let me check the files."}}',
    '{"type":"text","sessionID":"ses_x","part":{"type":"text","text":"The answer is 42."}}',
  ].join("\n");
  const result = parseOpencodeEvents(ndjson);
  assert.equal(result.output, "Let me check the files.The answer is 42.");
  assert.equal(result.finalText, "The answer is 42.");
});

test("truncates summary but keeps full output", () => {
  const longText = "a".repeat(300);
  const ndjson = `{"type":"text","sessionID":"ses_x","part":{"type":"text","text":"${longText}"}}`;
  const result = parseOpencodeEvents(ndjson);
  assert.equal(result.output, longText);
  assert.equal(result.summary.length, 201);
  assert.ok(result.summary.endsWith("…"));
});

test("has no terminal event when the stream is incomplete", () => {
  const result = parseOpencodeEvents('{"type":"step_start","sessionID":"ses_x","part":{}}');
  assert.equal(result.hasTerminalEvent, false);
  assert.equal(result.sessionId, "ses_x");
});

test("skips malformed lines without throwing", () => {
  const ndjson = [
    "not json at all {{{",
    '{"type":"text","sessionID":"ses_x","part":{"type":"text","text":"ok"}}',
  ].join("\n");
  const result = parseOpencodeEvents(ndjson);
  assert.equal(result.output, "ok");
});

test("returns an empty result for empty input", () => {
  const result = parseOpencodeEvents("");
  assert.equal(result.output, "");
  assert.equal(result.sessionId, null);
  assert.equal(result.hasTerminalEvent, false);
});

test("a step_finish with a non-stop reason is not treated as a terminal event", () => {
  const ndjson =
    '{"type":"step_finish","sessionID":"ses_x","part":{"type":"step-finish","reason":"tool_use","tokens":{"total":5,"input":5,"output":0,"reasoning":0,"cache":{"write":0,"read":0}},"cost":0.0001}}';
  const result = parseOpencodeEvents(ndjson);
  assert.equal(result.hasTerminalEvent, false);
});

test("parses an error event with a string error", () => {
  const ndjson = '{"type":"error","sessionID":"ses_x","error":"authentication failed"}';
  const result = parseOpencodeEvents(ndjson);
  assert.equal(result.error, "authentication failed");
});

test("parses an error event with an object error by JSON-stringifying it", () => {
  const ndjson = '{"type":"error","sessionID":"ses_x","error":{"name":"ModelError","message":"quota exceeded"}}';
  const result = parseOpencodeEvents(ndjson);
  assert.equal(result.error, JSON.stringify({ name: "ModelError", message: "quota exceeded" }));
});

test("returns a null error when no error event is present", () => {
  const result = parseOpencodeEvents('{"type":"text","sessionID":"ses_x","part":{"type":"text","text":"ok"}}');
  assert.equal(result.error, null);
});
