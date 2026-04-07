import { describe, expect, it } from "vitest";
import { RECENT_JOB_POST_WINDOW_MS } from "../constants.js";
import {
  DASHBOARD_VISIBILITY_WINDOW_MS,
  isUnitedStatesJobLocationOrTitle,
} from "../dashboard-visibility.js";

describe("dashboard visibility helpers", () => {
  it("keeps dashboard visibility window aligned with recent-job window", () => {
    expect(DASHBOARD_VISIBILITY_WINDOW_MS).toBe(RECENT_JOB_POST_WINDOW_MS);
  });

  it("matches US jobs using structured location", () => {
    expect(isUnitedStatesJobLocationOrTitle("Seattle, WA", "Software Engineer")).toBe(true);
    expect(isUnitedStatesJobLocationOrTitle("United States", "Software Engineer")).toBe(true);
  });

  it("matches US jobs when location is missing but title contains US metadata", () => {
    expect(
      isUnitedStatesJobLocationOrTitle(
        null,
        "Senior Software EngineerUnited States, Washington, RedmondPosted 2 hours ago"
      )
    ).toBe(true);
  });

  it("rejects non-US jobs", () => {
    expect(isUnitedStatesJobLocationOrTitle("Berlin, Germany", "Software Engineer")).toBe(false);
    expect(isUnitedStatesJobLocationOrTitle(null, "Software Engineer, Lisbon, Portugal")).toBe(false);
  });
});
