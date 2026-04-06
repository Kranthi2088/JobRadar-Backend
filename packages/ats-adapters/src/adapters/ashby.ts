import type { NormalizedJob } from "@jobradar/shared";
import { ATSAdapter } from "../adapter";

interface AshbyJobPosting {
  id: string;
  title: string;
  location: string;
  department: string;
  team: string;
  employmentType: string;
  publishedDate: string;
  applicationUrl: string;
  jobUrl: string;
}

interface AshbyGraphQLResponse {
  data: {
    jobBoard: {
      jobPostings: AshbyJobPosting[];
    };
  };
}

export class AshbyAdapter extends ATSAdapter {
  readonly atsType = "ashby";

  async fetchJobs(companySlug: string, endpoint: string): Promise<NormalizedJob[]> {
    const url = endpoint || "https://jobs.ashbyhq.com/api/non-employee-graphql";

    const query = {
      operationName: "ApiJobBoardWithTeams",
      variables: { organizationHostedJobsPageName: companySlug },
      query: `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
        jobBoard: jobBoardWithTeams(
          organizationHostedJobsPageName: $organizationHostedJobsPageName
        ) {
          jobPostings {
            id
            title
            location
            department
            team
            employmentType
            publishedDate
            applicationUrl
            jobUrl
          }
        }
      }`,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "JobRadar/1.0 (https://jobradar.app)",
      },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} from Ashby`);
      (error as any).status = response.status;
      throw error;
    }

    const data = (await response.json()) as AshbyGraphQLResponse;
    const postings = data?.data?.jobBoard?.jobPostings ?? [];

    return postings.map((posting) => this.normalize(posting, companySlug));
  }

  getApplyUrl(job: NormalizedJob): string {
    return job.url;
  }

  private normalize(posting: AshbyJobPosting, companySlug: string): NormalizedJob {
    let postedAt: Date | undefined;
    if (posting.publishedDate) {
      const d = new Date(posting.publishedDate);
      if (!Number.isNaN(d.getTime())) postedAt = d;
    }

    return {
      id: posting.id,
      title: posting.title,
      url: posting.applicationUrl || posting.jobUrl,
      team: posting.team || posting.department,
      location: posting.location,
      seniority: this.inferSeniority(posting.title),
      postedAt,
      detectedAt: new Date(),
      companySlug,
      atsType: this.atsType,
    };
  }

  private inferSeniority(title: string): string | undefined {
    const lower = title.toLowerCase();
    if (lower.includes("intern")) return "Intern";
    if (lower.includes("junior") || lower.includes("jr.")) return "Junior";
    if (lower.includes("senior") || lower.includes("sr.")) return "Senior";
    if (lower.includes("staff")) return "Staff";
    if (lower.includes("principal")) return "Principal";
    if (lower.includes("lead")) return "Lead";
    return undefined;
  }
}
