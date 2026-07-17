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
});
