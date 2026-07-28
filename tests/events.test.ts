import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEvents } from "../src/opencode/events.js";

const SAMPLE_NDJSON = [
  '{"type":"step_start","timestamp":1785174485749,"sessionID":"ses_05b4f2f9bffeo8a7lOYpoyaMES","part":{"id":"prt_fa4b0eae9001z1qcXeLKQdEfrS","messageID":"msg_fa4b0d0e500111Qp6p17m694hd","sessionID":"ses_05b4f2f9bffeo8a7lOYpoyaMES","type":"step-start"}}',
  '{"type":"text","timestamp":1785174486405,"sessionID":"ses_05b4f2f9bffeo8a7lOYpoyaMES","part":{"id":"prt_fa4b0ed53001aJEMK15ByLkzfQ","messageID":"msg_fa4b0d0e500111Qp6p17m694hd","sessionID":"ses_05b4f2f9bffeo8a7lOYpoyaMES","type":"text","text":"PONG","time":{"start":1785174486355,"end":1785174486388}}}',
  '{"type":"step_finish","timestamp":1785174486405,"sessionID":"ses_05b4f2f9bffeo8a7lOYpoyaMES","part":{"id":"prt_fa4b0ed78001oey7ntbj1WP6VC","reason":"stop","messageID":"msg_fa4b0d0e500111Qp6p17m694hd","sessionID":"ses_05b4f2f9bffeo8a7lOYpoyaMES","type":"step-finish","tokens":{"total":7138,"input":7093,"output":4,"reasoning":41,"cache":{"write":0,"read":0}},"cost":0.00691835}}',
  "",
].join("\n");

test("parses a real captured opencode event stream", () => {
  const result = parseEvents(SAMPLE_NDJSON);
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
  const result = parseEvents(ndjson);
  assert.equal(result.output, "Hello, world.");
});

test("truncates summary but keeps full output", () => {
  const longText = "a".repeat(300);
  const ndjson = `{"type":"text","sessionID":"ses_x","part":{"type":"text","text":"${longText}"}}`;
  const result = parseEvents(ndjson);
  assert.equal(result.output, longText);
  assert.equal(result.summary.length, 201);
  assert.ok(result.summary.endsWith("…"));
});

test("has no terminal event when the stream is incomplete", () => {
  const result = parseEvents('{"type":"step_start","sessionID":"ses_x","part":{}}');
  assert.equal(result.hasTerminalEvent, false);
  assert.equal(result.sessionId, "ses_x");
});

test("skips malformed lines without throwing", () => {
  const ndjson = [
    "not json at all {{{",
    '{"type":"text","sessionID":"ses_x","part":{"type":"text","text":"ok"}}',
  ].join("\n");
  const result = parseEvents(ndjson);
  assert.equal(result.output, "ok");
});

test("returns an empty result for empty input", () => {
  const result = parseEvents("");
  assert.equal(result.output, "");
  assert.equal(result.sessionId, null);
  assert.equal(result.hasTerminalEvent, false);
});
