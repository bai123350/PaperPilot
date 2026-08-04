import { beforeEach, describe, expect, it, vi } from "vitest";

import { PaperPilotApi } from "./api";

describe("PaperPilotApi", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("caches the demo session and sends it to authenticated requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    const api = new PaperPilotApi("http://api.test");

    await api.listProjects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
    });
    expect(localStorage.getItem("paperpilot_access_token")).toBe("token-1");
  });

  it("re-authenticates once when a cached token is rejected", async () => {
    localStorage.setItem("paperpilot_access_token", "expired-token");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token-2" }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    const api = new PaperPilotApi("http://api.test");

    await api.listProjects();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer token-2" }),
    });
    expect(localStorage.getItem("paperpilot_access_token")).toBe("token-2");
  });

  it("delivers streamed assistant deltas before the persisted message", async () => {
    localStorage.setItem("paperpilot_access_token", "token-1");
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: delta\r\ndata: {"content":"第一段"}\r\n\r\n',
        ));
        controller.enqueue(encoder.encode(
          'event: delta\r\ndata: {"content":"第二段"}\r\n\r\n' +
          'event: complete\r\ndata: {"message":{"id":"message-1","role":"assistant","content":"第一段第二段","evidence_ids":[],"report_version":1,"created_at":"2026-07-21T00:00:00Z"},"report_version":1}\r\n\r\n',
        ));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(body, { status: 200 }));
    const onDelta = vi.fn();
    const api = new PaperPilotApi("http://api.test");

    const result = await api.streamRunMessage("run-1", "继续讨论", onDelta);

    expect(onDelta.mock.calls.map(([value]) => value)).toEqual(["第一段", "第二段"]);
    expect(result.message.content).toBe("第一段第二段");
  });

  it("delivers persisted run operation updates and the terminal run state", async () => {
    localStorage.setItem("paperpilot_access_token", "token-1");
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'id: operation-1\r\nevent: operation\r\ndata: {"id":"operation-1","run_id":"run-1","sequence":1,"task_kind":"research_run","operation_kind":"search_source","stage":"searching","title":"检索文献来源","summary":"正在检索一个文献来源。","status":"running","metrics":{},"conversation_message_id":null,"started_at":"2026-07-23T00:00:00Z","completed_at":null}\r\n\r\n',
        ));
        controller.enqueue(encoder.encode(
          'event: done\r\ndata: {"id":"run-1","project_id":"project-1","status":"completed","stage":"auditing","error":null,"created_at":"2026-07-23T00:00:00Z","updated_at":"2026-07-23T00:01:00Z","completed_at":"2026-07-23T00:01:00Z","report_version":1}\r\n\r\n',
        ));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(body, { status: 200 }));
    const onOperation = vi.fn();
    const onDone = vi.fn();
    const api = new PaperPilotApi("http://api.test");

    await api.streamRunEvents("run-1", onOperation, onDone);

    expect(onOperation).toHaveBeenCalledWith(expect.objectContaining({
      id: "operation-1",
      status: "running",
    }));
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({
      id: "run-1",
      status: "completed",
    }));
  });

  it("sends the selected desktop model with conversation messages", async () => {
    localStorage.setItem("paperpilot_access_token", "token-1");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        message: {
          id: "message-1",
          role: "assistant",
          content: "reply",
          evidence_ids: [],
          report_version: null,
          created_at: "2026-07-21T00:00:00Z",
        },
        report_updated: false,
        report_version: 1,
      }), { status: 200 }),
    );
    const api = new PaperPilotApi("http://api.test");

    await api.sendRunMessage("run-1", "continue", "discuss", "deepseek-v4-flash");

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      content: "continue",
      action: "discuss",
      model: "deepseek-v4-flash",
    });
  });

  it("sends model credentials only in the authenticated settings request", async () => {
    localStorage.setItem("paperpilot_access_token", "token-1");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        provider: "openai",
        model: "gpt-5-mini",
        base_url: "https://api.openai.com/v1",
        configured: true,
        api_key_hint: "••••cret",
      }), { status: 200 }),
    );
    const api = new PaperPilotApi("http://api.test");

    await api.saveModelSettings({
      provider: "openai",
      model: "gpt-5-mini",
      base_url: "https://api.openai.com/v1",
      api_key: "openai-secret",
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/v1/model-settings");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "PUT",
      headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      api_key: "openai-secret",
    });
    expect(localStorage.getItem("openai-secret")).toBeNull();
  });
});
