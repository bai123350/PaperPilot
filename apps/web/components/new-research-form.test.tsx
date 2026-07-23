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
    fireEvent.click(screen.getByText("研究设置与 PDF"));
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

  it("keeps a short first message in the composer and explains the requirement", async () => {
    render(<NewResearchForm onSubmit={vi.fn()} />);
    const composer = screen.getByLabelText("给 PaperPilot 发送研究问题");
    fireEvent.change(composer, { target: { value: "太短" } });
    fireEvent.click(screen.getByRole("button", { name: "发送研究问题" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("至少 20 个字符");
    expect(composer).toHaveValue("太短");
  });
});
