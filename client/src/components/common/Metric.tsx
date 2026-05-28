export function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  )
}
