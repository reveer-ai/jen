import { expect, test } from "vitest";
import type { Item } from "./port.ts";
import { replies } from "./replies.ts";

const said = (text: string): Item => ({ type: "message", role: "assistant", text });
const heard = (text: string): Item => ({ type: "message", role: "user", from: "", text });
const call = (id: string): Item => ({ type: "tool_call", id, name: "wait", input: {} });
const result = (id: string): Item => ({ type: "tool_result", callId: id, output: "ok" });

test("a response with no tool call is a reply, its messages joined and trimmed", () => {
  expect(replies([heard("go"), said("Can"), said("berra. ")])).toEqual(["Canberra."]);
});

test("text before a tool call isn't a reply", () => {
  expect(replies([heard("go"), said("Let me ask."), call("c1"), result("c1"), said("done")])).toEqual(["done"]);
});

test("text after a tool call in the same response isn't a reply, even while the call is open", () => {
  expect(replies([heard("go"), call("c1"), said("I am waiting for the haiku.")])).toEqual([]);
});

test("text between a tool call and its result isn't a reply", () => {
  expect(replies([heard("go"), call("c1"), said("waiting"), result("c1")])).toEqual([]);
});

test("each turn's reply is found, and an empty one isn't", () => {
  expect(replies([heard("a"), said("one"), heard("b"), said(" "), heard("c"), said("two")])).toEqual(["one", "two"]);
});

test("a response read only in part can look like a reply until the rest arrives", () => {
  const response = [said("Checking."), call("c1")];
  expect(replies([heard("go"), ...response.slice(0, 1)])).toEqual(["Checking."]);
  expect(replies([heard("go"), ...response])).toEqual([]);
});
