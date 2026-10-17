import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  captureChoiceForShareStart,
  displayMediaVideoConstraints,
  enabledScreenShareQualities,
  fitSourceToCap,
  resolveScreenShareCapture,
  screenShareChoice,
} from "./screenShareQuality.ts";

function aspectDelta(
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
) {
  return Math.abs(width / height - sourceWidth / sourceHeight);
}

describe("enabledScreenShareQualities", () => {
  test("uncapped and 4K limits offer 3840x2160 at 100fps and another new choice", () => {
    for (const limit of [
      [0, 0],
      [3840, 2160],
    ] as const) {
      const catalog = enabledScreenShareQualities(limit);
      assert.equal(catalog.low?.fullName, "720p 30FPS");
      assert.equal(catalog.high?.fullName, "1080p 30FPS");
      assert.equal(catalog.text?.resolution.frameRate, 5);
      assert.equal(catalog.text?.encoding.maxFramerate, 5);

      const uhd = catalog.uhd100;
      assert.ok(uhd, `4K 100fps missing for limit ${limit.join("x")}`);
      assert.equal(uhd.fullName, "4K 100fps");
      assert.notEqual(uhd.name, catalog.qhd60?.name);
      assert.ok(catalog.qhd60, "1440p 60fps missing");
      assert.equal(catalog.qhd60.resolution.width, 2560);
      assert.equal(catalog.qhd60.resolution.height, 1440);
      assert.equal(catalog.qhd60.resolution.frameRate, 60);
      assert.equal(catalog.qhd60.encoding.maxFramerate, 60);
      assert.notEqual(catalog.qhd60.fullName, uhd.fullName);

      const capture = resolveScreenShareCapture(
        captureChoiceForShareStart(limit, "uhd100", false),
      );
      console.log(`limit ${limit.join("x")} 4K capture`, capture);
      assert.equal(capture.resolution.width, 3840);
      assert.equal(capture.resolution.height, 2160);
      assert.equal(capture.resolution.frameRate, 100);
      assert.equal(capture.encoding.maxFramerate, 100);
      assert.notEqual(capture.encoding.maxFramerate, 30);

      const asked = resolveScreenShareCapture(
        captureChoiceForShareStart(limit, "low", true),
      );
      assert.equal(asked.resolution.width, 3840);
      assert.equal(asked.resolution.height, 2160);
      assert.equal(asked.resolution.frameRate, 100);
      assert.equal(asked.encoding.maxFramerate, 100);
    }
  });

  test("1920x1080 hides 4K and 1280x720 keeps only the stock 720p preset among fixed sizes", () => {
    const at1080 = enabledScreenShareQualities([1920, 1080]);
    assert.equal(at1080.uhd100, undefined);
    assert.equal(at1080.qhd60, undefined);
    assert.equal(at1080.high?.resolution.width, 1920);
    assert.equal(at1080.low?.resolution.height, 720);
    assert.equal(
      screenShareChoice("uhd100", [1920, 1080]).resolution.width,
      1280,
    );

    const at720 = enabledScreenShareQualities([1280, 720]);
    assert.equal(at720.low?.fullName, "720p 30FPS");
    assert.equal(at720.low?.resolution.frameRate, 30);
    assert.equal(at720.high, undefined);
    assert.equal(at720.hd60, undefined);
    assert.equal(at720.qhd60, undefined);
    assert.equal(at720.uhd100, undefined);
    assert.equal(at720.text?.resolution.width, 1280);
    assert.equal(at720.text?.resolution.height, 720);
    assert.equal(at720.text?.encoding.maxFramerate, 5);
    console.log("1280x720 catalog", Object.keys(at720));
  });
});

describe("fitSourceToCap", () => {
  test("3440x1440 21:9 stays wider than 16:9 inside 3840x2160", () => {
    const fitted = fitSourceToCap(3440, 1440, 3840, 2160);
    console.log("3440x1440 ->", fitted);
    assert.equal(fitted.width, 3840);
    assert.ok(fitted.height <= 2160);
    assert.ok(fitted.width / fitted.height > 16 / 9);
    assert.ok(aspectDelta(fitted.width, fitted.height, 3440, 1440) < 0.01);
    assert.ok(Math.abs(fitted.height - 1600) <= 16);
  });

  test("5120x1440 32:9 stays wider than 16:9 inside 3840x2160", () => {
    const fitted = fitSourceToCap(5120, 1440, 3840, 2160);
    console.log("5120x1440 ->", fitted);
    assert.deepEqual(fitted, { width: 3840, height: 1080 });
    assert.ok(fitted.width / fitted.height > 16 / 9);
    assert.ok(aspectDelta(fitted.width, fitted.height, 5120, 1440) < 0.001);
    assert.ok(fitted.width <= 3840 && fitted.height <= 2160);
  });

  test("a server max tighter than the 4K cap squashes the same 32:9 frame", () => {
    const fitted = fitSourceToCap(5120, 1440, 3840, 2160, [1920, 1080]);
    console.log("5120x1440 server 1920x1080 ->", fitted);
    assert.ok(fitted.width <= 1920 && fitted.height <= 1080);
    assert.ok(fitted.width / fitted.height > 16 / 9);
    assert.ok(aspectDelta(fitted.width, fitted.height, 5120, 1440) < 0.01);
  });

  test("a known ultrawide source on the 4K 100fps choice keeps 100fps", () => {
    const choice = enabledScreenShareQualities([0, 0]).uhd100!;
    const capture = resolveScreenShareCapture(choice, {
      width: 5120,
      height: 1440,
    });
    console.log("5120x1440 on 4K 100fps", capture);
    assert.equal(capture.resolution.width, 3840);
    assert.equal(capture.resolution.height, 1080);
    assert.equal(capture.resolution.frameRate, 100);
    assert.equal(capture.encoding.maxFramerate, 100);
    assert.ok(capture.resolution.width / capture.resolution.height > 16 / 9);
  });
});

describe("displayMediaVideoConstraints", () => {
  test("requested 3840x2160 at 100fps is a max box without a 16:9 aspect lock", () => {
    const constraints = displayMediaVideoConstraints({
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: 100,
      aspectRatio: 16 / 9,
      displaySurface: "monitor",
    });
    console.log("display constraints", constraints);
    assert.deepEqual(constraints.width, { max: 3840 });
    assert.deepEqual(constraints.height, { max: 2160 });
    assert.deepEqual(constraints.frameRate, { ideal: 100, max: 100 });
    assert.equal("aspectRatio" in constraints, false);
    assert.equal(constraints.displaySurface, "monitor");
  });
});

describe("share start wiring", () => {
  test("state and the display-media hook use the shipped resolver", () => {
    const state = readFileSync(new URL("./state.tsx", import.meta.url), "utf8");
    const entry = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    assert.match(state, /resolveScreenShareCapture/);
    assert.match(state, /enabledScreenShareQualities/);
    assert.match(state, /screenShareEncoding:\s*capture\.encoding/);
    assert.match(entry, /displayMediaVideoConstraints/);
    assert.doesNotMatch(entry, /max:\s*640/);
    assert.doesNotMatch(entry, /ideal:\s*5/);
    assert.doesNotMatch(state, /ScreenSharePresets/);
  });
});
