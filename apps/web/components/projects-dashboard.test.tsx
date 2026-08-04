import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { ProjectsDashboard } from "./projects-dashboard";

const routerMock = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  routerMock.push.mockReset();
});

describe("ProjectsDashboard", () => {
  it("asks for a project name, persists it, then opens its workspace", async () => {
    vi.spyOn(api, "listProjects").mockResolvedValue([]);
    vi.spyOn(api, "createProject").mockResolvedValue({
      id: "project-1",
      name: "神经炎症证据图谱",
      description: "等待填写研究问题",
      created_at: "2026-08-04T00:00:00Z",
      updated_at: "2026-08-04T00:00:00Z",
    });

    render(<ProjectsDashboard />);
    await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    expect(screen.getByRole("dialog", { name: "命名研究项目" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("项目名称"), {
      target: { value: "神经炎症证据图谱" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));

    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith(
      "神经炎症证据图谱",
      "等待填写研究问题",
    ));
    expect(routerMock.push).toHaveBeenCalledWith("/projects/project-1");
  });
});
