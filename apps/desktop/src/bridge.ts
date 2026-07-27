import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  ExportFormat,
  ExportResult,
  MessageResult,
  Project,
  Report,
  ResearchBrief,
  ResearchRun,
  RunEvent,
  RunSnapshot,
} from "./generated/contracts";

export type ModelProvider = "deepseek" | "openai" | "qwen" | "custom";

export interface ModelSettings {
  provider: ModelProvider;
  model: string;
  baseUrl: string;
  configured: boolean;
  apiKeyHint: string | null;
}

export interface SaveModelSettingsInput {
  provider: ModelProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface DesktopBridge {
  listProjects(): Promise<Project[]>;
  getModelSettings(): Promise<ModelSettings | null>;
  saveModelSettings(input: SaveModelSettingsInput): Promise<ModelSettings>;
  createProject(name: string, description: string): Promise<Project>;
  startRun(projectId: string, brief: ResearchBrief): Promise<ResearchRun>;
  retryRun(runId: string): Promise<ResearchRun>;
  getRunSnapshot(runId: string): Promise<RunSnapshot>;
  getReport(runId: string, version?: number): Promise<Report>;
  exportReport(runId: string, format: ExportFormat): Promise<ExportResult>;
  sendMessage(runId: string, content: string): Promise<MessageResult>;
  deleteProject(projectId: string): Promise<void>;
  listenRunEvents(handler: (event: RunEvent) => void): Promise<UnlistenFn>;
}

export const tauriBridge: DesktopBridge = {
  listProjects: () => invoke("list_projects"),
  getModelSettings: () => invoke("get_model_settings"),
  saveModelSettings: (input) => invoke("save_model_settings", { input }),
  createProject: (name, description) => invoke("create_project", { name, description }),
  startRun: (projectId, brief) => invoke("start_run", { projectId, brief }),
  retryRun: (runId) => invoke("retry_run", { runId }),
  getRunSnapshot: (runId) => invoke("get_run_snapshot", { runId }),
  getReport: (runId, version) => invoke("get_report", { runId, version }),
  exportReport: (runId, format) => invoke("export_report", { runId, format }),
  sendMessage: (runId, content) => invoke("send_message", { runId, content }),
  deleteProject: (projectId) => invoke("delete_project", { projectId }),
  listenRunEvents: (handler) =>
    listen<RunEvent>("paperpilot://run-event", (event) => handler(event.payload)),
};
