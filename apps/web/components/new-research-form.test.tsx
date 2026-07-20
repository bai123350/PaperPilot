import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewResearchForm } from "./new-research-form";

afterEach(cleanup);

describe("NewResearchForm", () => {
  it("submits a structured biomedical research brief", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<NewResearchForm onSubmit={onSubmit} onAssist={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("研究问题"), {
      target: { value: "What evidence supports circulating biomarkers for treatment response?" },
    });
    fireEvent.change(screen.getByLabelText("研究人群"), {
      target: { value: "Adults receiving systemic therapy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始研究" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "What evidence supports circulating biomarkers for treatment response?",
        population: "Adults receiving systemic therapy",
      }),
      [],
    ));
  });

  it("keeps user and assistant messages visible across turns", async () => {
    const onAssist = vi.fn()
      .mockResolvedValueOnce({ role: "assistant", content: "先明确主要结局。" })
      .mockResolvedValueOnce({ role: "assistant", content: "可以使用客观缓解率。" });
    render(<NewResearchForm onSubmit={vi.fn()} onAssist={onAssist} />);

    fireEvent.change(screen.getByLabelText("研究问题"), {
      target: { value: "循环肿瘤 DNA 能否预测晚期结直肠癌的治疗响应？" },
    });
    const composer = screen.getByLabelText("给研究问题助手发送消息");
    fireEvent.change(composer, { target: { value: "这个范围是否太宽？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    expect(screen.getByText("这个范围是否太宽？")).toBeInTheDocument();
    expect(screen.getByText(/正在结合当前研究内容分析/)).toBeInTheDocument();
    expect(await screen.findByText("先明确主要结局。")).toBeInTheDocument();

    fireEvent.change(composer, { target: { value: "主要结局如何选择？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByText("可以使用客观缓解率。")).toBeInTheDocument();
    expect(onAssist).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: "循环肿瘤 DNA 能否预测晚期结直肠癌的治疗响应？" }),
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant", content: "先明确主要结局。" }),
        expect.objectContaining({ role: "user", content: "主要结局如何选择？" }),
      ]),
    );
  });
});
