import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

describe("AppShell model settings", () => {
  beforeEach(() => {
    navigation.pathname = "/";
    localStorage.clear();
  });

  afterEach(cleanup);

  it("opens the desktop-style settings dialog and persists the selected provider model", () => {
    render(<AppShell><div>dashboard</div></AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "模型设置" }));
    expect(screen.getByRole("dialog", { name: "配置大模型服务" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("大模型厂商"), { target: { value: "qwen" } });
    expect(screen.getByLabelText("模型名称")).toHaveValue("qwen-plus");
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    expect(localStorage.getItem("paperpilot.conversationModel")).toBe("qwen-plus");
  });

  it("shows the desktop model settings action in a project workspace", () => {
    navigation.pathname = "/projects/project-1";
    render(<AppShell><div>project</div></AppShell>);

    expect(screen.getByRole("button", { name: "模型设置" })).toBeVisible();
  });
});
