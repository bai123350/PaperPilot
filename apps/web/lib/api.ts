export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface RunRecord {
  id: string;
  project_id: string;
  status: "queued" | "running" | "waiting" | "retrying" | "completed" | "failed" | "cancelled";
  stage: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ResearchBriefInput {
  question: string;
  population?: string;
  intervention?: string;
  comparison?: string;
  outcomes?: string[];
  keywords?: string[];
  date_from?: number;
  date_to?: number;
  study_types?: string[];
}

const tokenKey = "paperpilot_access_token";

export class PaperPilotApi {
  constructor(private readonly baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000") {}

  async ensureSession(): Promise<string> {
    const cached = localStorage.getItem(tokenKey);
    if (cached) return cached;
    const response = await fetch(`${this.baseUrl}/v1/auth/demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "researcher@paperpilot.local", name: "PaperPilot Researcher" }),
    });
    const payload = await this.read<{ access_token: string }>(response);
    localStorage.setItem(tokenKey, payload.access_token);
    return payload.access_token;
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return this.authenticated<ProjectRecord[]>("/v1/projects");
  }

  async createProject(name: string, description = ""): Promise<ProjectRecord> {
    return this.authenticated<ProjectRecord>("/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
  }

  async getProject(id: string): Promise<ProjectRecord> {
    return this.authenticated<ProjectRecord>(`/v1/projects/${id}`);
  }

  async deleteProject(id: string): Promise<void> {
    await this.authenticated<void>(`/v1/projects/${id}`, { method: "DELETE" });
  }

  async createRun(projectId: string, brief: ResearchBriefInput): Promise<RunRecord> {
    return this.authenticated<RunRecord>(`/v1/projects/${projectId}/runs`, {
      method: "POST",
      body: JSON.stringify(brief),
    });
  }

  async uploadPdf(projectId: string, file: File): Promise<{ object_key: string }> {
    const ticket = await this.authenticated<{
      upload_url: string;
      required_headers: Record<string, string>;
    }>(`/v1/projects/${projectId}/uploads/presign`, {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        content_type: "application/pdf",
        size: file.size,
      }),
    });
    const response = await fetch(`${this.baseUrl}${ticket.upload_url}`, {
      method: "PUT",
      headers: ticket.required_headers,
      body: file,
    });
    return this.read<{ object_key: string }>(response);
  }

  async getRun(id: string): Promise<RunRecord> {
    return this.authenticated<RunRecord>(`/v1/runs/${id}`);
  }

  async getReport(id: string): Promise<unknown> {
    return this.authenticated<unknown>(`/v1/runs/${id}/report`);
  }

  async downloadMarkdown(id: string): Promise<Blob> {
    const token = await this.ensureSession();
    const response = await fetch(`${this.baseUrl}/v1/runs/${id}/report.md`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Markdown 导出失败");
    return response.blob();
  }

  async retryRun(id: string): Promise<RunRecord> {
    return this.authenticated<RunRecord>(`/v1/runs/${id}/retry`, { method: "POST" });
  }

  async cancelRun(id: string): Promise<RunRecord> {
    return this.authenticated<RunRecord>(`/v1/runs/${id}/cancel`, { method: "POST" });
  }

  private async authenticated<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.ensureSession();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    return this.read<T>(response);
  }

  private async read<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(payload.detail ?? `Request failed (${response.status})`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}

export const api = new PaperPilotApi();
