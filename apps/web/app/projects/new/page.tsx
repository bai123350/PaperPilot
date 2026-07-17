import { NewProjectWorkflow } from "../../../components/new-project-workflow";

export default function NewProjectPage() {
  return (
    <>
      <section className="page-heading narrow-heading">
        <div><span className="eyebrow">New research</span><h1>定义研究问题</h1><p>生物医学探索性研究情报</p></div>
      </section>
      <NewProjectWorkflow />
    </>
  );
}
