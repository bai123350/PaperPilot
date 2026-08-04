"use client";

import { KeyRound, Save, Settings, ShieldCheck, X } from "lucide-react";
import { FormEvent, useState } from "react";

import {
  api,
  type ModelProvider,
  type ModelSettings,
} from "../lib/api";
import { useConversationModel } from "../lib/conversation-model";

const providerDefaults: Record<ModelProvider, {
  label: string;
  model: string;
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
  custom: {
    label: "其他 OpenAI-compatible",
    model: "",
    baseUrl: "",
  },
};

export function ModelSettingsControl({ compact = false }: { compact?: boolean }) {
  const [, setConversationModel] = useConversationModel();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<ModelProvider>("deepseek");
  const [model, setModel] = useState("deepseek-v4-pro");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com");
  const [apiKey, setApiKey] = useState("");
  const [current, setCurrent] = useState<ModelSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openDialog() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setApiKey("");
    try {
      const settings = await api.getModelSettings();
      applySettings(settings);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "模型设置加载失败");
    } finally {
      setLoading(false);
    }
  }

  function applySettings(settings: ModelSettings) {
    setCurrent(settings);
    setProvider(settings.provider);
    setModel(settings.model);
    setBaseUrl(settings.base_url);
    setConversationModel(settings.model);
  }

  function changeProvider(nextProvider: ModelProvider) {
    setProvider(nextProvider);
    setModel(providerDefaults[nextProvider].model);
    setBaseUrl(providerDefaults[nextProvider].baseUrl);
    setApiKey("");
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const settings = await api.saveModelSettings({
        provider,
        model: model.trim(),
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
      });
      applySettings(settings);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "模型设置保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        className={`model-settings-trigger${compact ? " compact" : ""}`}
        type="button"
        aria-label="模型设置"
        onClick={() => void openDialog()}
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
              <button type="button" className="model-settings-close" disabled={saving} onClick={() => setOpen(false)} aria-label="关闭模型设置">
                <X size={17} aria-hidden="true" />
              </button>
            </header>
            <p className="model-settings-intro">与桌面端一致，配置厂商、API Key、模型名称和 API 地址。API Key 加密保存在服务端，界面不会回显完整密钥。</p>
            <form onSubmit={(event) => void save(event)}>
              <label>
                大模型厂商
                <select aria-label="大模型厂商" value={provider} disabled={loading || saving} onChange={(event) => changeProvider(event.target.value as ModelProvider)}>
                  {Object.entries(providerDefaults).map(([value, item]) => (
                    <option key={value} value={value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                API Key
                <input
                  aria-label="API Key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={current?.configured && current.provider === provider
                    ? `留空以保留 ${current.api_key_hint ?? "现有密钥"}`
                    : "sk-…"}
                  disabled={loading || saving}
                />
              </label>
              <label>
                模型名称
                {provider === "deepseek" ? (
                  <select aria-label="模型名称" value={model} disabled={loading || saving} onChange={(event) => setModel(event.target.value)}>
                    <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
                    <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
                  </select>
                ) : (
                  <input aria-label="模型名称" value={model} disabled={loading || saving} onChange={(event) => setModel(event.target.value)} placeholder="例如 gpt-5-mini" />
                )}
              </label>
              <label>
                API 地址
                <input aria-label="API 地址" value={baseUrl} disabled={loading || saving} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://…/v1" />
              </label>
              {error ? <p className="model-settings-error" role="alert">{error}</p> : null}
              <div className="model-settings-security"><ShieldCheck size={15} aria-hidden="true" />完整密钥不会返回网页，也不会写入浏览器存储或日志。</div>
              <footer>
                <button type="button" disabled={saving} onClick={() => setOpen(false)}>取消</button>
                <button className="model-settings-save" type="submit" disabled={loading || saving || !model.trim() || !baseUrl.trim()}>
                  <Save size={16} aria-hidden="true" />{saving ? "正在保存…" : "保存设置"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
