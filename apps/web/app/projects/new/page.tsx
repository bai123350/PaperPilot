import { NewProjectWorkflow } from "../../../components/new-project-workflow";

export default function NewProjectPage() {
  return (
    <>
      <section className="page-heading narrow-heading chat-page-heading">
        <div><span className="eyebrow">New research</span><h1>和 PaperPilot 讨论你的研究</h1><p>对话、研究进度、证据和报告会持续保存在同一项目中</p></div>
      </section>
      <NewProjectWorkflow />
    </>
  );
}
