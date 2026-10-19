export type ProxySettings =
  | { mode: "system" }
  | { mode: "direct" }
  | { mode: "manual"; host: string; port: number };

export interface ProxySettingsState {
  settings: ProxySettings;
  restartRequired: boolean;
  warning?: string;
}

export interface ProxyCheckResult {
  connected: boolean;
  route: "direct" | "proxy" | "unknown";
  status?: number;
  elapsedMs: number;
  message?: string;
  warning?: string;
}
