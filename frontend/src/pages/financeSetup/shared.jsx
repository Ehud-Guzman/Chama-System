// Small shared input so the four cycle figures stay one shape.
export function Field({ id, label, value, onChange, money: isMoney, disabled = false }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
          isMoney ? 'amount' : ''
        }`}
      />
    </div>
  );
}
