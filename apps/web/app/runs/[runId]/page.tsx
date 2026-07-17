import { RunWorkspaceClient } from "../../../components/run-workspace-client";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <RunWorkspaceClient runId={runId} />;
}
