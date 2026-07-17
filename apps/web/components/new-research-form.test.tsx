import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NewResearchForm } from "./new-research-form";

describe("NewResearchForm", () => {
  it("submits a structured biomedical research brief", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<NewResearchForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("研究问题"), {
      target: { value: "What evidence supports circulating biomarkers for treatment response?" },
    });
    fireEvent.change(screen.getByLabelText("研究人群"), {
      target: { value: "Adults receiving systemic therapy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始研究" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "What evidence supports circulating biomarkers for treatment response?",
        population: "Adults receiving systemic therapy",
      }),
      [],
    );
  });
});
