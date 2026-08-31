export function highestAgentTrajectorySequence(
  events: readonly { sequence: number }[],
): number {
  return events.reduce((highest, event) => (
    Number.isSafeInteger(event.sequence)
    && event.sequence >= 0
    && event.sequence > highest
      ? event.sequence
      : highest
  ), 0);
}
