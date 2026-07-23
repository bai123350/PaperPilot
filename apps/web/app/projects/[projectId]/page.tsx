import { NewProjectWorkflow } from "../../../components/new-project-workflow";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <>
      <section className="page-heading narrow-heading chat-page-heading">
        <div><span className="eyebrow">Existing project</span><h1>继续研究对话</h1><p>对话、研究进度和报告都在当前页面持续更新</p></div>
      </section>
      <NewProjectWorkflow projectId={projectId} />
    </>
  );
}
