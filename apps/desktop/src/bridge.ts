import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  MessageResult,
  Project,
  Report,
  ResearchBrief,
  ResearchRun,
  RunEvent,
  RunSnapshot,
} from "./generated/contracts";

export interface DesktopBridge {
  listProjects(): Promise<Project[]>;
  createProject(name: string, description: string): Promise<Project>;
  startRun(projectId: string, brief: ResearchBrief): Promise<ResearchRun>;
  getRunSnapshot(runId: string): Promise<RunSnapshot>;
  getReport(runId: string, version?: number): Promise<Report>;
  sendMessage(runId: string, content: string): Promise<MessageResult>;
  deleteProject(projectId: string): Promise<void>;
  onRunEvent(listener: (event: RunEvent) => void): Promise<() => void>;
}

export const tauriBridge: DesktopBridge = {
  listProjects: () => invoke("list_projects"),
  createProject: (name, description) => invoke("create_project", { name, description }),
  startRun: (projectId, brief) => invoke("start_run", { projectId, brief }),
  getRunSnapshot: (runId) => invoke("get_run_snapshot", { runId }),
  getReport: (runId, version) => invoke("get_report", { runId, version }),
  sendMessage: (runId, content) => invoke("send_message", { runId, content }),
  deleteProject: (projectId) => invoke("delete_project", { projectId }),
  onRunEvent: (listener) =>
    listen<RunEvent>("paperpilot://run-event", (event) => listener(event.payload)),
};
