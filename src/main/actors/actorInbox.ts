// Actor inbox + registry (contracts v1.4 §5, Patch 18).
//
// `send(actorId, msg)` enqueues an ActorMessage into the target actor's inbox.
// Pre-stop/post-stop ReAct re-entry drains the inbox (up to MAX_PRE_REACT) so a
// peer can inject instructions mid-turn without the actor going idle. The
// registry maps actorId → handle so `send` works peer-to-peer, not just
// parent→child.

import { randomUUID } from "node:crypto";

export const MAX_PRE_RE_ACT = 4;

export interface ActorMessage {
  id: string;
  fromActorId: string | null; // null = parent / external
  toActorId: string;
  payload: unknown;
  sentAt: string;
  deliveredAt?: string;
}

export class ActorInbox {
  private queues = new Map<string, ActorMessage[]>();

  send(fromActorId: string | null, toActorId: string, payload: unknown, now: () => string): ActorMessage {
    const msg: ActorMessage = { id: randomUUID(), fromActorId, toActorId, payload, sentAt: now() };
    const q = this.queues.get(toActorId) ?? [];
    q.push(msg);
    this.queues.set(toActorId, q);
    return msg;
  }

  drain(actorId: string): ActorMessage[] {
    const q = this.queues.get(actorId) ?? [];
    const out = [...q];
    this.queues.set(actorId, []);
    return out;
  }

  pending(actorId: string): number {
    return this.queues.get(actorId)?.length ?? 0;
  }

  markUndelivered(actorId: string, now: () => string): ActorMessage[] {
    const q = this.queues.get(actorId) ?? [];
    const undelivered = q.map((m) => ({ ...m, deliveredAt: undefined }));
    this.queues.set(actorId, []);
    void now;
    return undelivered;
  }
}

export { MAX_PRE_RE_ACT as MAX_PRE_REACT };
