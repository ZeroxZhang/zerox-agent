export type ProductionSmokeLock = {
  path: string;
  release(): Promise<void>;
};

export function getProductionSmokeLockPath(
  rootDir: string,
  tempRoot?: string,
): string;

export function acquireProductionSmokeLock(options: {
  rootDir: string;
  tempRoot?: string;
  lockPath?: string;
  pid?: number;
  now?: () => number;
  processExists?: (pid: number) => boolean;
}): Promise<ProductionSmokeLock>;
