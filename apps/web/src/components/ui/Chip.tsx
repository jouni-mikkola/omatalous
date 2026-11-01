import { IconButton } from "./IconButton.tsx";

/** A filter that is on, with the × that takes it off. Only filters are chips. */
export function Chip({ label, removeLabel, onRemove }: { label: string; removeLabel: string; onRemove: () => void }) {
  return (
    <span className="chip">
      {label}
      <IconButton label={removeLabel} onClick={onRemove}>
        ×
      </IconButton>
    </span>
  );
}
