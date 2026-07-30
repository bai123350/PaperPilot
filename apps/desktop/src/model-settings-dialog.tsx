import { useEffect, useState } from "react";
import { KeyRound, Save, ShieldCheck, X } from "lucide-react";

import type {
  ModelProvider,
  ModelSettings,
  SaveModelSettingsInput,
} from "./bridge";

const providerDefaults: Record<
  ModelProvider,
  { label: string; model: string; baseUrl: string }
> = {
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

const deepseekModels = [
  { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
] as const;

export function ModelSettingsDialog({
  current,
  required,
  saving,
  error,
  onClose,
  onSave,
}: {
  current: ModelSettings | null;
  required: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: SaveModelSettingsInput) => Promise<void> | void;
}) {
  const initialProvider = current?.provider ?? "deepseek";
  const [provider, setProvider] = useState<ModelProvider>(initialProvider);
  const [model, setModel] = useState(
    current?.model ?? providerDefaults[initialProvider].model,
  );
  const [baseUrl, setBaseUrl] = useState(
    current?.baseUrl ?? providerDefaults[initialProvider].baseUrl,
  );
  const [apiKey, setApiKey] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    const nextProvider = current?.provider ?? "deepseek";
    setProvider(nextProvider);
    setModel(current?.model ?? providerDefaults[nextProvider].model);
    setBaseUrl(current?.baseUrl ?? providerDefaults[nextProvider].baseUrl);
    setApiKey("");
    setValidationError(null);
  }, [current]);

  function changeProvider(next: ModelProvider) {
    setProvider(next);
    setModel(providerDefaults[next].model);
    setBaseUrl(providerDefaults[next].baseUrl);
    setValidationError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!model.trim()) {
      setValidationError("请输入要使用的模型名称。");
      return;
    }
    if (!isAllowedEndpoint(baseUrl)) {
      setValidationError("API 地址必须使用 HTTPS；本机服务可使用 http://localhost。");
      return;
    }
    if (
      !apiKey.trim()
      && (!current?.configured || current.provider !== provider)
    ) {
      setValidationError(
        current?.configured
          ? "切换大模型厂商时需要填写对应的 API Key。"
          : "首次配置需要填写 API Key。",
      );
      return;
    }
    setValidationError(null);
    await onSave({
      provider,
      model: model.trim(),
      baseUrl: baseUrl.trim().replace(/\/+$/, ""),
      apiKey: apiKey.trim(),
    });
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section
        className="model-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-settings-title"
      >
        <header>
          <span className="settings-icon"><KeyRound size={19} aria-hidden="true" /></span>
          <div>
            <span className="settings-kicker">{required ? "首次使用" : "本地设置"}</span>
            <h2 id="model-settings-title">配置大模型服务</h2>
          </div>
          {!required ? (
            <button type="button" className="settings-close" onClick={onClose} aria-label="关闭设置">
              <X size={17} aria-hidden="true" />
            </button>
          ) : null}
        </header>

        <p className="settings-intro">
          PaperPilot 需要一个 OpenAI-compatible API。配置仅保存在本机，API Key 由
          Windows Credential Manager 保护。
        </p>

        <form onSubmit={(event) => void submit(event)}>
          <label>
            大模型厂商
            <select
              aria-label="大模型厂商"
              value={provider}
              onChange={(event) => changeProvider(event.target.value as ModelProvider)}
              disabled={saving}
            >
              {Object.entries(providerDefaults).map(([value, item]) => (
                <option value={value} key={value}>{item.label}</option>
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
              placeholder={current?.configured ? `留空以保留 ${current.apiKeyHint ?? "现有密钥"}` : "sk-…"}
              disabled={saving}
            />
          </label>
          <label>
            模型名称
            {provider === "deepseek" ? (
              <select
                aria-label="模型名称"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={saving}
              >
                {deepseekModels.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            ) : (
              <input
                aria-label="模型名称"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="例如 gpt-5-mini"
                disabled={saving}
              />
            )}
            {provider === "deepseek" ? <small>可随时在研究输入框中切换 Flash 或 Pro。</small> : null}
          </label>
          <label>
            API 地址
            <input
              aria-label="API 地址"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://…/v1"
              disabled={saving}
            />
          </label>

          {validationError || error ? (
            <p className="settings-error" role="alert">{validationError ?? error}</p>
          ) : null}
          <div className="settings-security">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>界面不会回显完整密钥，日志也不会记录凭据。</span>
          </div>
          <footer>
            {!required ? <button type="button" onClick={onClose} disabled={saving}>取消</button> : null}
            <button className="settings-save" type="submit" disabled={saving}>
              <Save size={16} aria-hidden="true" />
              {saving ? "正在保存…" : required ? "保存并继续" : "保存设置"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function isAllowedEndpoint(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:"
      || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  } catch {
    return false;
  }
}
