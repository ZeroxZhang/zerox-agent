export function getSystemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function formatDateInTimeZone(date: Date, timeZone = getSystemTimeZone()): string {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fall back to the process-local date if the platform rejects the timezone.
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildDateContextPrompt(currentDate: string, timeZone?: string): string {
  const today = normalizeIsoDate(currentDate);
  const yesterday = shiftIsoDate(today, -1);
  const dayBeforeYesterday = shiftIsoDate(today, -2);
  const tomorrow = shiftIsoDate(today, 1);

  return [
    "本地日期与时间语义：",
    ...(timeZone ? [`- 用户系统时区 / system timezone: ${timeZone}`] : []),
    `- 今天 / today: ${today}`,
    `- 昨天 / yesterday: ${yesterday}`,
    `- 前天 / day before yesterday: ${dayBeforeYesterday}`,
    `- 明天 / tomorrow: ${tomorrow}`,
    "- 遇到“今天”“昨天”“前天”“明天”“最近”“latest”“today”“yesterday”等相对或日期敏感表述时，必须先按以上锚点解析为绝对日期，再搜索、执行和回答。",
    "- 使用 web_search 处理日期敏感事实时，web_search 查询词必须包含解析后的绝对日期；不要只搜索“昨天”“今天”等相对日期。",
    "- 如果搜索结果日期与解析日期冲突，不要使用与解析日期冲突的旧搜索结果；改用带绝对日期的查询，或明确说明来源不匹配。",
  ].join("\n");
}

function normalizeIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return formatDateInTimeZone(new Date(value));
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function shiftIsoDate(value: string, offsetDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}
