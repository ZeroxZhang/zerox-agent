import { maskPreviewSecrets } from "../../../shared/chatOutput";

type JsonPreviewProps = {
  value: unknown;
  label?: string;
  className?: string;
};

export function JsonPreview({ value, label, className }: JsonPreviewProps) {
  if (value === undefined) {
    return null;
  }

  const classNames = ["chat-json-preview", className].filter(Boolean).join(" ");

  return (
    <div className={classNames}>
      {label ? <span className="chat-json-preview-label">{label}</span> : null}
      <pre>{stringifyPreview(value)}</pre>
    </div>
  );
}

function stringifyPreview(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const maskedValue = maskPreviewSecrets(value);
    const json = JSON.stringify(
      maskedValue,
      (_key, item: unknown) => {
        if (typeof item === "bigint") {
          return item.toString();
        }
        if (item instanceof Error) {
          return { name: item.name, message: item.message };
        }
        if (item instanceof Map) {
          return Object.fromEntries(item);
        }
        if (item instanceof Set) {
          return Array.from(item);
        }
        if (item && typeof item === "object") {
          if (seen.has(item)) {
            return "[Circular]";
          }
          seen.add(item);
        }
        return item;
      },
      2,
    );
    return json ?? String(maskedValue);
  } catch (error) {
    return error instanceof Error
      ? `[Unserializable preview: ${error.message}]`
      : "[Unserializable preview]";
  }
}
