export type MemoryProfileDocument = {
  content: string;
  updatedAt: string;
};

export type ReadMemoryProfileResult =
  | { ok: true; profile: MemoryProfileDocument }
  | { ok: false; message: string };

export type SaveMemoryProfileResult =
  | { ok: true; profile: MemoryProfileDocument }
  | { ok: false; message: string };
