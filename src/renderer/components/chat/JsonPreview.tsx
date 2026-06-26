import { stringifyMaskedPreview } from "../../../shared/chatOutput";

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
  return stringifyMaskedPreview(value);
}
