export type IconName =
  | "plus"
  | "more"
  | "close"
  | "command"
  | "folder"
  | "send"
  | "stop"
  | "expand"
  | "collapse"
  | "tool"
  | "thinking"
  | "approval"
  | "settings"
  | "run"
  | "task";

const iconPaths: Record<IconName, string> = {
  plus: "M12 5v14M5 12h14",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  close: "M6 6l12 12M18 6 6 18",
  command:
    "M9 9H6.5A2.5 2.5 0 1 1 9 6.5V17.5A2.5 2.5 0 1 1 6.5 15H17.5A2.5 2.5 0 1 1 15 17.5V6.5A2.5 2.5 0 1 1 17.5 9H9Z",
  folder: "M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  send: "M4 12 20 4l-4 16-4-6-8-2Z",
  stop: "M7 7h10v10H7z",
  expand: "M8 10l4 4 4-4",
  collapse: "M8 14l4-4 4 4",
  tool:
    "M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-3-3 2.4-2.4Z",
  thinking: "M12 4a7 7 0 0 0-3 13.3V20h6v-2.7A7 7 0 0 0 12 4Z",
  approval: "M20 6 9 17l-5-5",
  settings: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM4 12h2M18 12h2M12 4v2M12 18v2",
  run: "M8 5v14l11-7L8 5Z",
  task: "M5 6h14M5 12h14M5 18h10",
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path
        d={iconPaths[name]}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
