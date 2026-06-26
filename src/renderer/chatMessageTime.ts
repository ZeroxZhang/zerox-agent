export type ChatMessageTimeRole = "assistant" | "user";

export function formatChatMessageTime(options: {
  role: ChatMessageTimeRole;
  createdAt: string;
  now?: Date;
  locale?: string;
  timeZone?: string;
}): string {
  const createdAt = new Date(options.createdAt);
  if (!Number.isFinite(createdAt.getTime())) {
    return "时间未知";
  }

  const now = options.now ?? new Date();
  const locale = options.locale ?? "zh-CN";
  if (options.role === "user") {
    return formatRelativeTime(createdAt, now, locale, options.timeZone);
  }

  return formatAbsoluteMessageTime(createdAt, now, locale, options.timeZone);
}

function formatRelativeTime(
  createdAt: Date,
  now: Date,
  locale: string,
  timeZone: string | undefined,
): string {
  const diffMs = Math.max(0, now.getTime() - createdAt.getTime());
  const minuteMs = 60_000;
  const hourMs = minuteMs * 60;
  const dayMs = hourMs * 24;

  if (diffMs < minuteMs) {
    return "刚刚";
  }
  if (diffMs < hourMs) {
    return `${Math.max(1, Math.floor(diffMs / minuteMs))} 分钟前`;
  }
  if (diffMs < dayMs) {
    return `${Math.max(1, Math.floor(diffMs / hourMs))} 小时前`;
  }
  if (diffMs < dayMs * 7) {
    return `${Math.max(1, Math.floor(diffMs / dayMs))} 天前`;
  }

  return formatAbsoluteMessageTime(createdAt, now, locale, timeZone);
}

function formatAbsoluteMessageTime(
  createdAt: Date,
  now: Date,
  locale: string,
  timeZone: string | undefined,
): string {
  const createdDateParts = getLocalDateParts(createdAt, locale, timeZone);
  const nowDateParts = getLocalDateParts(now, locale, timeZone);
  const clock = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  }).format(createdAt);

  if (isSameLocalDay(createdDateParts, nowDateParts)) {
    return `今天 ${clock}`;
  }
  if (createdDateParts.year === nowDateParts.year) {
    return `${createdDateParts.month}月${createdDateParts.day}日 ${clock}`;
  }
  return `${createdDateParts.year}年${createdDateParts.month}月${createdDateParts.day}日 ${clock}`;
}

function getLocalDateParts(
  date: Date,
  locale: string,
  timeZone: string | undefined,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? 0),
    month: Number(parts.find((part) => part.type === "month")?.value ?? 0),
    day: Number(parts.find((part) => part.type === "day")?.value ?? 0),
  };
}

function isSameLocalDay(
  left: { year: number; month: number; day: number },
  right: { year: number; month: number; day: number },
): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day
  );
}
