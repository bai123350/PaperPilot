import { Clock3, KeyRound, Server, Trash2 } from "lucide-react";

export default function SettingsPage() {
  return (
    <>
      <section className="page-heading narrow-heading">
        <div><span className="eyebrow">Data controls</span><h1>隐私与数据</h1><p>当前工作区的数据处理边界</p></div>
      </section>
      <div className="settings-list">
        <section><Clock3 size={20} /><div><h2>原文件保留</h2><p>研究任务完成后最多保留 24 小时</p></div><strong>24h</strong></section>
        <section><KeyRound size={20} /><div><h2>传输与存储</h2><p>TLS 传输，生产环境使用 KMS 信封加密</p></div><strong>启用</strong></section>
        <section><Server size={20} /><div><h2>模型数据策略</h2><p>仅允许不训练、不留存的企业 API</p></div><strong>严格</strong></section>
        <section><Trash2 size={20} /><div><h2>项目删除</h2><p>对象、正文、向量、缓存与中间产物一并删除</p></div><strong>≤15m</strong></section>
      </div>
    </>
  );
}
