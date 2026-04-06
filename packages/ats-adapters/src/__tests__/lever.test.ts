import { describe, it, expect, vi, beforeEach } from "vitest";
import { LeverAdapter } from "../adapters/lever";

const mockLeverResponse = [
  {
    id: "abc-123",
    text: "Senior Backend Engineer",
    hostedUrl: "https://jobs.lever.co/testco/abc-123",
    applyUrl: "https://jobs.lever.co/testco/abc-123/apply",
    categories: {
      team: "Backend",
      location: "San Francisco, CA",
      department: "Engineering",
      commitment: "Full-time",
      level: "Senior",
    },
    createdAt: 1710500000000,
  },
  {
    id: "def-456",
    text: "Junior Data Analyst",
    hostedUrl: "https://jobs.lever.co/testco/def-456",
    applyUrl: "https://jobs.lever.co/testco/def-456/apply",
    categories: {
      team: "Data",
      location: "Remote",
      department: "Analytics",
      commitment: "Full-time",
    },
    createdAt: 1710600000000,
  },
];

describe("LeverAdapter", () => {
  let adapter: LeverAdapter;

  beforeEach(() => {
    adapter = new LeverAdapter();
    vi.restoreAllMocks();
  });

  it("should have atsType 'lever'", () => {
    expect(adapter.atsType).toBe("lever");
  });

  it("should fetch and normalize postings", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockLeverResponse,
    } as Response);

    const jobs = await adapter.fetchJobs("testco", "");

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: "abc-123",
      title: "Senior Backend Engineer",
      url: "https://jobs.lever.co/testco/abc-123",
      team: "Backend",
      location: "San Francisco, CA",
      seniority: "Senior",
      companySlug: "testco",
      atsType: "lever",
    });
  });

  it("should infer seniority from title when category level is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockLeverResponse,
    } as Response);

    const jobs = await adapter.fetchJobs("testco", "");
    expect(jobs[1].seniority).toBe("Junior");
  });

  it("should generate correct apply URL", () => {
    const job = {
      id: "abc-123",
      title: "Engineer",
      url: "https://jobs.lever.co/testco/abc-123",
      detectedAt: new Date(),
      companySlug: "testco",
      atsType: "lever",
    };
    expect(adapter.getApplyUrl(job)).toBe(
      "https://jobs.lever.co/testco/abc-123/apply"
    );
  });

  it("should construct default URL from slug", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    await adapter.fetchJobs("stripe", "");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.lever.co/v0/postings/stripe?mode=json",
      expect.any(Object)
    );
  });

  it("should throw on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    await expect(adapter.fetchJobs("testco", "")).rejects.toThrow("HTTP 503");
  });
});
