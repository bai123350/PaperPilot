"use client";

import { KeyRound, Save, Settings, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import type { ConversationModel } from "../lib/api";
import { useConversationModel } from "../lib/conversation-model";

type ModelProvider = "deepseek" | "openai" | "qwen";

const providerDefaults: Record<ModelProvider, {
  label: string;
  model: ConversationModel;
  baseUrl: string;
}> = {
  deepseek: {
    label: "DeepSeek",
    model: "deepseek-v4-pro",
    baseUrl: "https://api.deepseek.com",
  },
  openai: {
    label: "OpenAI",
    model: "gpt-5-mini",
    baseUrl: "https://api.openai.com/v1",
  },
  qwen: {
    label: "通义千问",
    model: "qwen-plus",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
};

export function ModelSettingsControl({ compact = false }: { compact?: boolean }) {
  const [model, setModel] = useConversationModel();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<ModelProvider>(() => providerForModel(model));
  const [draftModel, setDraftModel] = useState<ConversationModel>(model);

  function openDialog() {
    setProvider(providerForModel(model));
    setDraftModel(model);
    setOpen(true);
  }

  function changeProvider(nextProvider: ModelProvider) {
    setProvider(nextProvider);
    setDraftModel(providerDefaults[nextProvider].model);
  }

  return (
    <>
      <button
        className={`model-settings-trigger${compact ? " compact" : ""}`}
        type="button"
        aria-label="模型设置"
        onClick={openDialog}
      >
        <Settings size={15} aria-hidden="true" />
        <span>模型设置</span>
      </button>
      {open ? (
        <div className="model-settings-backdrop" role="presentation">
          <section className="model-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
            <header>
              <span className="model-settings-icon"><KeyRound size={19} aria-hidden="true" /></span>
              <div><span className="eyebrow">模型服务</span><h2 id="model-settings-title">配置大模型服务</h2></div>
              <button type="button" className="model-settings-close" onClick={() => setOpen(false)} aria-label="关闭模型设置">
                <X size={17} aria-hidden="true" />
              </button>
            </header>
            <p className="model-settings-intro">与桌面端一致，先选择大模型厂商，再选择该厂商提供的模型。API 凭据由网页服务端安全配置。</p>
            <form onSubmit={(event) => {
              event.preventDefault();
              setModel(draftModel);
              setOpen(false);
            }}>
              <label>
                大模型厂商
                <select aria-label="大模型厂商" value={provider} onChange={(event) => changeProvider(event.target.value as ModelProvider)}>
                  {Object.entries(providerDefaults).map(([value, item]) => (
                    <option key={value} value={value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                模型名称
                <select aria-label="模型名称" value={draftModel} onChange={(event) => setDraftModel(event.target.value as ConversationModel)}>
                  {provider === "deepseek" ? (
                    <>
                      <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
                      <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
                    </>
                  ) : null}
                  {provider === "openai" ? <option value="gpt-5-mini">GPT-5 mini</option> : null}
                  {provider === "qwen" ? <option value="qwen-plus">Qwen Plus</option> : null}
                </select>
              </label>
              <label>
                API 地址
                <input aria-label="API 地址" value={providerDefaults[provider].baseUrl} readOnly />
              </label>
              <div className="model-settings-security"><ShieldCheck size={15} aria-hidden="true" />网页不会读取或回显服务端 API Key。</div>
              <footer>
                <button type="button" onClick={() => setOpen(false)}>取消</button>
                <button className="model-settings-save" type="submit"><Save size={16} aria-hidden="true" />保存设置</button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

function providerForModel(model: ConversationModel): ModelProvider {
  if (model === "gpt-5-mini") return "openai";
  if (model === "qwen-plus") return "qwen";
  return "deepseek";
}
