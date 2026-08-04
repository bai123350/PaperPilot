import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewResearchForm } from "./new-research-form";

afterEach(cleanup);

describe("NewResearchForm", () => {
  it("creates a persistent research conversation from the first message", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<NewResearchForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("给 PaperPilot 发送研究问题"), {
      target: { value: "What evidence supports circulating biomarkers for treatment response?" },
    });
    fireEvent.click(screen.getByText("研究设置与 PDF", { selector: "summary" }));
    fireEvent.change(screen.getByLabelText("研究人群"), {
      target: { value: "Adults receiving systemic therapy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送研究问题" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "What evidence supports circulating biomarkers for treatment response?",
        population: "Adults receiving systemic therapy",
      }),
      [],
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant" }),
        expect.objectContaining({
          role: "user",
          content: "What evidence supports circulating biomarkers for treatment response?",
        }),
      ]),
    ));
    expect(screen.queryByRole("button", { name: "开始研究" })).not.toBeInTheDocument();
  });

  it("accepts a concise first research question", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<NewResearchForm onSubmit={onSubmit} />);
    const composer = screen.getByLabelText("给 PaperPilot 发送研究问题");
    fireEvent.change(composer, { target: { value: "青光眼研究" } });
    fireEvent.click(screen.getByRole("button", { name: "发送研究问题" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ question: "青光眼研究" }),
      [],
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "青光眼研究" }),
      ]),
    ));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses the desktop-style composer controls", () => {
    localStorage.removeItem("paperpilot.permissionMode");
    const onModelChange = vi.fn();
    render(
      <NewResearchForm
        model="deepseek-v4-pro"
        onModelChange={onModelChange}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("添加"));
    fireEvent.click(screen.getByRole("button", { name: /研究设置与 PDF/ }));
    expect(screen.getByLabelText("研究人群")).toBeVisible();

    fireEvent.change(screen.getByRole("combobox", { name: "当前使用的模型" }), {
      target: { value: "deepseek-v4-flash" },
    });
    expect(onModelChange).toHaveBeenCalledWith("deepseek-v4-flash");
    expect(screen.getByLabelText("权限：替我审批")).toBeInTheDocument();
  });
});
