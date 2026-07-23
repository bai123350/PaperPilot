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
});
