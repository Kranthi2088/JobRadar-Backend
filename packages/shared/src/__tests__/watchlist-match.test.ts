import { describe, expect, it } from "vitest";
import { jobMatchesAnyWatchlist, jobMatchesWatchlist } from "../types";

describe("watchlist matching", () => {
  it("matches by company and keyword", () => {
    const matched = jobMatchesWatchlist(
      {
        companyId: "microsoft-id",
        title: "Senior Software Engineer",
        location: null,
        seniority: "Senior",
      },
      {
        companyId: "microsoft-id",
        roleKeyword: "software engineer",
        locationFilter: null,
        seniorityFilter: null,
      }
    );

    expect(matched).toBe(true);
  });

  it("supports location filter when location metadata is embedded in title", () => {
    const matched = jobMatchesWatchlist(
      {
        companyId: "microsoft-id",
        title: "Senior Software EngineerUnited States, Washington, RedmondPosted 2 hours ago",
        location: null,
        seniority: "Senior",
      },
      {
        companyId: "microsoft-id",
        roleKeyword: "software engineer",
        locationFilter: "United States",
        seniorityFilter: null,
      }
    );

    expect(matched).toBe(true);
  });

  it("rejects mismatched company or missing keyword", () => {
    expect(
      jobMatchesWatchlist(
        {
          companyId: "meta-id",
          title: "Senior Software Engineer",
          location: "Menlo Park, CA",
          seniority: "Senior",
        },
        {
          companyId: "microsoft-id",
          roleKeyword: "software engineer",
          locationFilter: null,
          seniorityFilter: null,
        }
      )
    ).toBe(false);

    expect(
      jobMatchesWatchlist(
        {
          companyId: "microsoft-id",
          title: "Product Manager",
          location: "Redmond, WA",
          seniority: "Senior",
        },
        {
          companyId: "microsoft-id",
          roleKeyword: "software engineer",
          locationFilter: null,
          seniorityFilter: null,
        }
      )
    ).toBe(false);
  });

  it("matches any watchlist entry when at least one rule matches", () => {
    const matched = jobMatchesAnyWatchlist(
      {
        companyId: "meta-id",
        title: "Software Engineer, Infrastructure",
        location: "Sunnyvale, CA",
        seniority: "Senior",
      },
      [
        {
          companyId: "microsoft-id",
          roleKeyword: "software engineer",
          locationFilter: null,
          seniorityFilter: null,
        },
        {
          companyId: "meta-id",
          roleKeyword: "software engineer",
          locationFilter: "CA",
          seniorityFilter: "senior",
        },
      ]
    );

    expect(matched).toBe(true);
  });
});
