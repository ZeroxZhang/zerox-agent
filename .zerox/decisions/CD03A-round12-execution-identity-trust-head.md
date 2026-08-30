# CD03A Round12 Execution Identity Trust Head

## Status

Accepted for append-only implementation after the Round11 runtime rejection.

## Context

Round11 bound predecessor identity and passed contract plus governance review.
Runtime rejected the frozen candidate with three Major findings:

- a crash after marker hard-link durability but before journal unlink leaves a
  valid two-link state that the recovery entry rejects;
- publication parent identities are recorded in the journal but not enforced
  during execution or recovery;
- the caller-pinned Node executable is checked only at runner startup, not
  immediately around each checker/harness execution.

Two independent read-only mutation probes reproduced all three findings.

## Decision

Round12 is a new append-only trust head.

- Recovery accepts a journal/marker pair only when both names are private,
  byte-identical, and reference the same inode with exactly two links; it then
  retires the journal name descriptor-relatively and fsyncs the held parent.
- Every publication reopens the expected parent and compares its canonical
  identity digest with the journal before any leaf mutation and after commit.
- Candidate execution revalidates the caller-pinned Node executable path,
  device, inode, mode, owner, link count, and SHA-256 immediately before and
  after every subprocess.
- All Round11 evidence and V11 source bytes remain immutable.

## Consequences

- No pathname-only cleanup or unchecked executable handoff is admissible.
- Round12 must add real crash/swap probes for all three findings.
- No transition or closure publication is allowed before three zero-finding
  Round12 reviews.
