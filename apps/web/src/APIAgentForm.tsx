import { useEffect, useState } from "react";
import type { APIConnection } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@reader/ui/components/select";
const protocols = {
  auto: "中转站的非官方api默认使用openai协议",
  openai: "OpenAI Chat Completions",
  anthropic: "Anthropic Messages",
} as const;
const DEFAULT_API_URL = "https://api.deepseek.com";

/** Endpoint, protocol and key of the "api" agent. A saved key is
 * never sent back; leaving the field empty keeps it. */
export function APIAgentForm({
  connection,
  disabled,
  onSave,
}: {
  connection: APIConnection;
  disabled: boolean;
  onSave: (connection: APIConnection) => Promise<void>;
}) {
  const [url, setURL] = useState(connection.url || DEFAULT_API_URL);
  const [protocol, setProtocol] = useState<
    NonNullable<APIConnection["protocol"]>
  >(connection.protocol ?? "auto");
  useEffect(
    () => setProtocol(connection.protocol ?? "auto"),
    [connection.protocol],
  );
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setURL(connection.url || DEFAULT_API_URL), [connection.url]);
  const changed =
    url.trim() !== connection.url ||
    key.trim() !== "" ||
    protocol !== (connection.protocol ?? "auto");
  const save = async () => {
    setSaving(true);
    try {
      const endpoint = url.trim();
      // Clearing the address also removes the saved key.
      await onSave(
        endpoint
          ? {
              url: endpoint,
              protocol,
              model: "",
              key: key.trim() || undefined,
              hasKey: key.trim() ? false : connection.hasKey,
            }
          : { url: "", model: "", key: "", hasKey: false },
      );
      setKey("");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) void save();
      }}
    >
      <Input
        aria-label="API 地址"
        autoComplete="off"
        spellCheck={false}
        value={url}
        disabled={disabled || saving}
        onChange={(event) => setURL(event.target.value)}
      />
      <Select
        value={protocol}
        disabled={disabled || saving}
        onValueChange={(value) => value && setProtocol(value)}
      >
        <SelectTrigger aria-label="API 协议">
          <SelectValue>{protocols[protocol]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(protocols).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Input
          aria-label="API Key"
          type="password"
          autoComplete="off"
          placeholder={connection.hasKey ? "已保存，留空保持不变" : "API Key"}
          value={key}
          disabled={disabled || saving}
          onChange={(event) => setKey(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={disabled || saving || !changed}
        >
          保存
        </Button>
      </div>
    </form>
  );
}

/** Adds a model ID that the endpoint's /models list does not include. */
export function APIModelForm({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (id: string) => Promise<void>;
}) {
  const [id, setID] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const model = id.trim();
        if (!model) return;
        setSaving(true);
        void onAdd(model)
          .then(() => setID(""))
          .finally(() => setSaving(false));
      }}
    >
      <Input
        aria-label="添加模型 ID"
        placeholder="手动添加模型 ID"
        autoComplete="off"
        spellCheck={false}
        value={id}
        disabled={disabled || saving}
        onChange={(event) => setID(event.target.value)}
      />
      <Button
        type="submit"
        variant="outline"
        disabled={disabled || saving || !id.trim()}
      >
        添加
      </Button>
    </form>
  );
}
