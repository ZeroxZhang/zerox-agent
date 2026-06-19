// Checkpoint-writer flag (contracts v1.4 §5, Patch 7/9).

export type CheckpointWriterMode = "p5-fork" | "p2-transition" | "off";

export function resolveCheckpointWriterFlag(
  env: NodeJS.ProcessEnv = process.env,
): CheckpointWriterMode {
  const raw = (env.ZEROX_CHECKPOINT_WRITER ?? "").toLowerCase();
  if (raw === "p2-transition") return "p2-transition";
  if (raw === "off") return "off";
  return "p5-fork"; // default once P5 has landed (spec D4)
}
