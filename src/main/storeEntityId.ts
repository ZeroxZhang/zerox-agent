const safeStoreEntityIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;

export function isSafeStoreEntityId(value: string): boolean {
  return safeStoreEntityIdPattern.test(value);
}

export function assertSafeStoreEntityId(value: string, label: string): void {
  if (!isSafeStoreEntityId(value)) {
    throw new Error(`${label} is invalid.`);
  }
}
