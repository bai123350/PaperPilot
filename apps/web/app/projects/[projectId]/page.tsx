import { NewProjectWorkflow } from "../../../components/new-project-workflow";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <NewProjectWorkflow projectId={projectId} />;
}
