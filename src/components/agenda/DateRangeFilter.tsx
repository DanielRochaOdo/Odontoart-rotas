export type DateRange = { from?: string; to?: string };

type DateRangeFilterProps = {
  label: string;
  value: DateRange;
  onChange: (next: DateRange) => void;
};

export default function DateRangeFilter({ label, value, onChange }: DateRangeFilterProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={value.from ?? ""}
          onChange={(event) => onChange({ ...value, from: event.target.value || undefined })}
          className="rounded-lg border border-mist px-2 py-1 text-xs outline-none focus:border-sea"
        />
        <span className="text-xs text-muted">ate</span>
        <input
          type="date"
          value={value.to ?? ""}
          onChange={(event) => onChange({ ...value, to: event.target.value || undefined })}
          className="rounded-lg border border-mist px-2 py-1 text-xs outline-none focus:border-sea"
        />
      </div>
    </div>
  );
}
