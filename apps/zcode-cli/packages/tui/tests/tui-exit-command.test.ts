import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { testRender } from "@mbears/opentui-react/test-utils";
import { TuiApp } from "../src/app.js";
import type { TuiOptions, TuiPromptInput } from "../src/types.js";

test("a command result asking to exit closes the TUI with code 0", async () => {
  const exits: number[] = [];
  const submitted: TuiPromptInput[] = [];
  let view: Awaited<ReturnType<typeof testRender>> | undefined;

  const options: TuiOptions = {
    noColor: true,
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
    submitPrompt: async (input) => {
      submitted.push(input);
      return input === "/exit" ? { response: "", exit: true } : { response: "done" };
    },
  };

  await act(async () => {
    view = await testRender(
      React.createElement(TuiApp, {
        copySelection: async () => ({ kind: "empty" }),
        hasCopyableSelection: () => false,
        onExit: (code) => {
          exits.push(code);
        },
        options,
      }),
      { exitOnCtrlC: false, height: 24, kittyKeyboard: true, otherModifiersMode: true, width: 100 },
    );
    await view.renderOnce();
  });

  try {
    await act(async () => {
      assert.ok(view);
      await view.mockInput.typeText("/exit");
      view.mockInput.pressEnter();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await view.renderOnce();
    });
    assert.deepEqual(submitted, ["/exit"]);
    assert.deepEqual(exits, [0]);
  } finally {
    await act(async () => {
      view?.renderer.destroy();
    });
  }
});
