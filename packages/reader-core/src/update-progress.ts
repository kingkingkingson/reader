/** Visible update work, sent from the desktop shell; null clears it. */
export interface UpdateProgress {
  version: string;
  phase: "download" | "prepare";
  received: number;
  /** Undefined when the download size is unknown. */
  total?: number;
}
