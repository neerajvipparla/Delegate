import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCursorEvents } from "../src/backends/cursor/events.js";

const SAMPLE_NDJSON = [
  '{"type":"system","subtype":"init","session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff","model":"Composer 2.5"}',
  '{"type":"assistant","session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff","message":{"role":"assistant","content":[{"type":"text","text":"Done!"}]}}',
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":5234,"result":"Done!","session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff"}',
  "",
].join("\n");

test("parses a cursor stream-json event sequence", () => {
  const result = parseCursorEvents(SAMPLE_NDJSON);
  assert.equal(result.output, "Done!");
  assert.equal(result.sessionId, "c6b62c6f-7ead-4fd6-9922-e952131177ff");
  assert.equal(result.hasTerminalEvent, true);
  assert.equal(result.tokens, null);
  assert.equal(result.cost, null);
  assert.equal(result.durationMs, 5234);
});

test("concatenates assistant parts when no terminal result is present", () => {
  const ndjson = [
    '{"type":"system","subtype":"init","session_id":"sess_x"}',
    '{"type":"assistant","session_id":"sess_x","message":{"role":"assistant","content":[{"type":"text","text":"Hello, "}]}}',
    '{"type":"assistant","session_id":"sess_x","message":{"role":"assistant","content":[{"type":"text","text":"world."}]}}',
  ].join("\n");
  const result = parseCursorEvents(ndjson);
  assert.equal(result.output, "Hello, world.");
  assert.equal(result.hasTerminalEvent, false);
});

test("prefers terminal result text over assistant parts", () => {
  const ndjson = [
    '{"type":"assistant","session_id":"sess_x","message":{"role":"assistant","content":[{"type":"text","text":"partial"}]}}',
    '{"type":"result","subtype":"success","is_error":false,"duration_ms":100,"result":"final answer","session_id":"sess_x"}',
  ].join("\n");
  const result = parseCursorEvents(ndjson);
  assert.equal(result.output, "final answer");
});

test("skips malformed lines without throwing", () => {
  const ndjson = [
    "not json",
    '{"type":"assistant","session_id":"sess_x","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}',
  ].join("\n");
  const result = parseCursorEvents(ndjson);
  assert.equal(result.output, "ok");
});
