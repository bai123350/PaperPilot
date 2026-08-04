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
  report_version: number;
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
  model?: ConversationModel;
}

export interface ResearchAssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RunConversationMessage extends ResearchAssistantMessage {
  id: string;
  evidence_ids: string[];
  report_version: number | null;
  created_at: string;
}

export interface RunConversation {
  contract_version: "1.0";
  report_version: number;
  messages: RunConversationMessage[];
}

export type ConversationModel =
  | "deepseek-v4-flash"
  | "deepseek-v4-pro"
  | "gpt-5-mini"
  | "qwen-plus";

export type RunOperationStatus = "running" | "completed" | "failed";
export type RunOperationTaskKind = "research_run" | "discussion" | "report_revision";
export type RunOperationKind =
  | "structure_question"
  | "search_source"
  | "search_dataset_source"
  | "deduplicate"
  | "screen"
  | "parse"
  | "create_evidence"
  | "synthesize"
  | "recommend"
  | "citation_audit"
  | "save_report"
  | "lookup_evidence"
  | "grounded_response"
  | "save_response"
  | "revise_report"
  | "revision_validation"
  | "save_revision";

export interface RunOperation {
  id: string;
  run_id: string;
  sequence: number;
  task_kind: RunOperationTaskKind;
  operation_kind: RunOperationKind;
  stage: string | null;
  title: string;
  summary: string;
  status: RunOperationStatus;
  metrics: Record<string, number>;
  conversation_message_id: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface RunOperationList {
  contract_version: "1.0";
  operations: RunOperation[];
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

  async listProjectRuns(projectId: string): Promise<RunRecord[]> {
    return this.authenticated<RunRecord[]>(`/v1/projects/${projectId}/runs`);
  }

  async askResearchAssistant(
    brief: ResearchBriefInput,
    messages: ResearchAssistantMessage[],
  ): Promise<ResearchAssistantMessage> {
    const response = await this.authenticated<{
      contract_version: "1.0";
      message: ResearchAssistantMessage;
    }>("/v1/research-assistant/messages", {
      method: "POST",
      body: JSON.stringify({ contract_version: "1.0", brief, messages: messages.slice(-12) }),
    });
    return response.message;
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

  async startRun(id: string): Promise<RunRecord> {
    return this.authenticated<RunRecord>(`/v1/runs/${id}/start`, { method: "POST" });
  }

  async getReport(id: string): Promise<unknown> {
    return this.authenticated<unknown>(`/v1/runs/${id}/report`);
  }

  async getRunConversation(id: string): Promise<RunConversation> {
    return this.authenticated<RunConversation>(`/v1/runs/${id}/conversation`);
  }

  async getRunOperations(id: string): Promise<RunOperationList> {
    return this.authenticated<RunOperationList>(`/v1/runs/${id}/operations`);
  }

  async streamRunEvents(
    id: string,
    onOperation: (operation: RunOperation) => void,
    onDone: (run: RunRecord) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const request = async (token: string) => fetch(`${this.baseUrl}/v1/runs/${id}/events`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
      },
      signal,
    });
    let response = await request(await this.ensureSession());
    if (response.status === 401) {
      localStorage.removeItem(tokenKey);
      response = await request(await this.ensureSession());
    }
    if (!response.ok || !response.body) {
      await this.read(response);
      throw new Error("研究操作流暂时不可用");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = (block: string) => {
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) return;
      const payload = JSON.parse(data.join("\n"));
      if (event === "operation") onOperation(payload as RunOperation);
      if (event === "done") onDone(payload as RunRecord);
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
  }

  async bootstrapRunConversation(
    id: string,
    messages: ResearchAssistantMessage[],
  ): Promise<RunConversation> {
    return this.authenticated<RunConversation>(`/v1/runs/${id}/conversation/bootstrap`, {
      method: "POST",
      body: JSON.stringify({ messages }),
    });
  }

  async sendRunMessage(
    id: string,
    content: string,
    action: "discuss" | "revise_report" = "discuss",
    model?: ConversationModel,
  ): Promise<{ message: RunConversationMessage; report_updated: boolean; report_version: number }> {
    return this.authenticated(`/v1/runs/${id}/conversation/messages`, {
      method: "POST",
      body: JSON.stringify({ contract_version: "1.0", content, action, model }),
    });
  }

  async streamRunMessage(
    id: string,
    content: string,
    onDelta: (content: string) => void,
    appendUser = true,
    model?: ConversationModel,
  ): Promise<{ message: RunConversationMessage; report_version: number }> {
    const request = async (token: string) => fetch(
      `${this.baseUrl}/v1/runs/${id}/conversation/messages/stream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          contract_version: "1.0",
          content,
          append_user: appendUser,
          model,
        }),
      },
    );

    let response = await request(await this.ensureSession());
    if (response.status === 401) {
      localStorage.removeItem(tokenKey);
      response = await request(await this.ensureSession());
    }
    if (!response.ok || !response.body) {
      await this.read(response);
      throw new Error("研究对话暂时不可用");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: { message: RunConversationMessage; report_version: number } | null = null;

    const consume = (block: string) => {
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) return;
      const payload = JSON.parse(data.join("\n"));
      if (event === "delta") onDelta(payload.content);
      if (event === "complete") result = payload;
      if (event === "error") throw new Error(payload.detail ?? "研究对话暂时不可用");
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!result) throw new Error("研究对话流意外中断");
    return result;
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
    const requestWithToken = async (token: string) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers as Record<string, string> | undefined),
      };
      return fetch(`${this.baseUrl}${path}`, { ...init, headers });
    };

    let response = await requestWithToken(await this.ensureSession());
    if (response.status === 401) {
      localStorage.removeItem(tokenKey);
      response = await requestWithToken(await this.ensureSession());
    }
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
