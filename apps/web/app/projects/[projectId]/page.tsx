import { NewProjectWorkflow } from "../../../components/new-project-workflow";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <>
      <section className="page-heading narrow-heading">
        <div><span className="eyebrow">Existing project</span><h1>发起新的研究运行</h1><p>保留项目边界，生成独立版本报告</p></div>
      </section>
      <NewProjectWorkflow projectId={projectId} />
    </>
  );
}
