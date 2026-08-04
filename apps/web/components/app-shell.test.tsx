import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";
import { api } from "../lib/api";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

describe("AppShell model settings", () => {
  beforeEach(() => {
    navigation.pathname = "/";
    localStorage.clear();
    vi.spyOn(api, "getModelSettings").mockResolvedValue({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      base_url: "https://api.deepseek.com",
      configured: true,
      api_key_hint: "••••test",
    });
    vi.spyOn(api, "saveModelSettings").mockResolvedValue({
      provider: "qwen",
      model: "qwen-plus",
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      configured: true,
      api_key_hint: "••••cret",
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("saves the API key through the backend without putting it in browser storage", async () => {
    render(<AppShell><div>dashboard</div></AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "模型设置" }));
    expect(screen.getByRole("dialog", { name: "配置大模型服务" })).toBeVisible();
    await waitFor(() => expect(api.getModelSettings).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("大模型厂商"), { target: { value: "qwen" } });
    expect(screen.getByLabelText("模型名称")).toHaveValue("qwen-plus");
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "qwen-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(api.saveModelSettings).toHaveBeenCalledWith({
      provider: "qwen",
      model: "qwen-plus",
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      api_key: "qwen-secret",
    }));
    expect(localStorage.getItem("paperpilot.conversationModel")).toBe("qwen-plus");
    expect(Object.values(localStorage)).not.toContain("qwen-secret");
  });

  it("shows the desktop model settings action in a project workspace", () => {
    navigation.pathname = "/projects/project-1";
    render(<AppShell><div>project</div></AppShell>);

    expect(screen.getByRole("button", { name: "模型设置" })).toBeVisible();
  });
});
