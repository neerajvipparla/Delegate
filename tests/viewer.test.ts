import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { Server, AddressInfo } from "node:net";
import { startViewer } from "../src/logging/viewer.js";

let dir: string;
let logPath: string;
const servers: Server[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "claude-delegate-viewer-"));
  logPath = join(dir, "server.log");
  writeFileSync(logPath, "");
});

afterEach(async () => {
  for (const s of servers.splice(0)) {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  rmSync(dir, { recursive: true, force: true });
});

async function start(port: number, path: string, onError?: (e: Error) => void) {
  const server = startViewer(port, path, onError) as unknown as Server;
  servers.push(server);
  await once(server, "listening");
  return server;
}
function portOf(server: Server): number {
  return (server.address() as AddressInfo).port;
}
async function get(port: number, path: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, text: await res.text() };
}

test("GET / returns the HTML page with the session filter control", async () => {
  const server = await start(0, logPath);
  const { status, text } = await get(portOf(server), "/");
  assert.equal(status, 200);
  assert.match(text, /<!doctype html>/i);
  assert.match(text, /id="session-filter"/);
});

test("the page shows full session ids and the prompt/response, not truncated ids", async () => {
  const server = await start(0, logPath);
  const { text } = await get(portOf(server), "/");
  // session id is rendered in full — no fixed-width slice of the session value
  assert.ok(!/slice\(0\s*,\s*1[06]\)/.test(text), "session id must not be sliced to a fixed width");
  // prompt and response are surfaced in the row details
  assert.match(text, /prompt_preview/);
  assert.match(text, /response_preview/);
});

test("GET /logs?offset=0 returns the file contents and the new offset", async () => {
  appendFileSync(logPath, '{"ts":"t","level":"info","pid":1,"event":"server_start","msg":"hi"}\n');
  const server = await start(0, logPath);
  const { status, text } = await get(portOf(server), "/logs?offset=0");
  assert.equal(status, 200);
  const body = JSON.parse(text);
  assert.match(body.data, /server_start/);
  assert.equal(body.nextOffset, Buffer.byteLength('{"ts":"t","level":"info","pid":1,"event":"server_start","msg":"hi"}\n'));
});

test("GET /logs with a prior offset returns only the newly appended bytes", async () => {
  const first = '{"a":1}\n';
  appendFileSync(logPath, first);
  const server = await start(0, logPath);
  const firstRes = JSON.parse((await get(portOf(server), "/logs?offset=0")).text);
  appendFileSync(logPath, '{"b":2}\n');
  const secondRes = JSON.parse((await get(portOf(server), `/logs?offset=${firstRes.nextOffset}`)).text);
  assert.equal(secondRes.data, '{"b":2}\n');
});

test("GET /logs with an offset beyond EOF resets to the whole file", async () => {
  appendFileSync(logPath, '{"a":1}\n');
  const server = await start(0, logPath);
  const res = JSON.parse((await get(portOf(server), "/logs?offset=999999")).text);
  assert.match(res.data, /"a":1/);
});

test("a second viewer on an already-bound port does not throw and reports the error via onError", async () => {
  const first = await start(0, logPath);
  const port = portOf(first);
  let captured: Error | null = null;
  // Bind to the SAME concrete port; must not throw, must invoke onError.
  const second = startViewer(port, logPath, (e) => (captured = e)) as unknown as Server;
  servers.push(second);
  await once(second, "error").catch(() => {});
  // give the async error handler a tick
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(captured, "onError should have been called for the port collision");
});

test("GET /logs returns 500 when the log path is a directory instead of a file", async () => {
  const logDir = join(dir, "logdir");
  mkdirSync(logDir);
  const server = await start(0, logDir);
  const { status, text } = await get(portOf(server), "/logs?offset=0");
  assert.equal(status, 500);
  assert.equal(text, "internal error");
});
