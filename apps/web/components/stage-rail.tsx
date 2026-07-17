import { Check, Circle, LoaderCircle } from "lucide-react";

import { researchStages, type RunStatus, type StageKey } from "../lib/stages";

export function StageRail({
  currentStage,
  status,
}: {
  currentStage: StageKey | null;
  status: RunStatus;
}) {
  const currentIndex = currentStage
    ? researchStages.findIndex((item) => item.key === currentStage)
    : -1;

  return (
    <ol className="stage-rail" aria-label="研究进度">
      {researchStages.map((stage, index) => {
        const state = status === "completed" || index < currentIndex
          ? "complete"
          : index === currentIndex
            ? "current"
            : "pending";
        return (
          <li data-state={state} key={stage.key}>
            <span className="stage-marker" aria-hidden="true">
              {state === "complete" ? <Check size={14} /> : state === "current" ? <LoaderCircle size={15} /> : <Circle size={10} />}
            </span>
            <span>
              <strong>{stage.label}</strong>
              <small>{stage.description}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
