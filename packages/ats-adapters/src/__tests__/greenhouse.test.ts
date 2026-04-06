import { describe, it, expect, vi, beforeEach } from "vitest";
import { GreenhouseAdapter } from "../adapters/greenhouse";

const mockGreenhouseResponse = {
  jobs: [
    {
      id: 12345,
      title: "Senior Software Engineer",
      absolute_url: "https://boards.greenhouse.io/testco/jobs/12345",
      location: { name: "San Francisco, CA" },
      updated_at: "2026-03-15T12:00:00Z",
      departments: [{ name: "Engineering" }],
      metadata: [{ name: "level", value: "Senior" }],
    },
    {
      id: 12346,
      title: "Product Manager",
      absolute_url: "https://boards.greenhouse.io/testco/jobs/12346",
      location: { name: "New York, NY" },
      updated_at: "2026-03-16T12:00:00Z",
      departments: [{ name: "Product" }],
      metadata: [],
    },
    {
      id: 12347,
      title: "Staff Frontend Engineer",
      absolute_url: "https://boards.greenhouse.io/testco/jobs/12347",
      location: { name: "Remote" },
      updated_at: "2026-03-17T12:00:00Z",
      departments: [{ name: "Engineering" }],
      metadata: [],
    },
  ],
};

describe("GreenhouseAdapter", () => {
  let adapter: GreenhouseAdapter;

  beforeEach(() => {
    adapter = new GreenhouseAdapter();
    vi.restoreAllMocks();
  });

  it("should have atsType 'greenhouse'", () => {
    expect(adapter.atsType).toBe("greenhouse");
  });

  it("should fetch and normalize jobs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockGreenhouseResponse,
    } as Response);

    const jobs = await adapter.fetchJobs("testco", "");

    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({
      id: "12345",
      title: "Senior Software Engineer",
      url: "https://boards.greenhouse.io/testco/jobs/12345",
      team: "Engineering",
      location: "San Francisco, CA",
      postedAt: new Date("2026-03-15T12:00:00Z"),
      companySlug: "testco",
      atsType: "greenhouse",
    });
  });

  it("should use metadata seniority when available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockGreenhouseResponse,
    } as Response);

    const jobs = await adapter.fetchJobs("testco", "");
    expect(jobs[0].seniority).toBe("Senior");
  });

  it("should infer seniority from title when metadata is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockGreenhouseResponse,
    } as Response);

    const jobs = await adapter.fetchJobs("testco", "");
    expect(jobs[2].seniority).toBe("Staff");
  });

  it("should use custom endpoint when provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ jobs: [] }),
    } as Response);

    await adapter.fetchJobs("testco", "https://custom.api.com/jobs");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://custom.api.com/jobs",
      expect.any(Object)
    );
  });

  it("should throw on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 429,
    } as Response);

    await expect(adapter.fetchJobs("testco", "")).rejects.toThrow("HTTP 429");
  });

  it("should return correct apply URL", () => {
    const job = {
      id: "123",
      title: "Test",
      url: "https://boards.greenhouse.io/testco/jobs/123",
      detectedAt: new Date(),
      companySlug: "testco",
      atsType: "greenhouse",
    };
    expect(adapter.getApplyUrl(job)).toBe(job.url);
  });
});
