export type AppUpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "downloading"
  | "downloaded"
  | "installing"
  | "up_to_date"
  | "error";

export type AppUpdateState = {
  phase: AppUpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  progressPercent?: number;
  checkedAt?: string;
  message?: string;
};

export type AppUpdateActionResult =
  | { ok: true; state: AppUpdateState }
  | { ok: false; state: AppUpdateState; message: string };
