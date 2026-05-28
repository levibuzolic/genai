export function Fact({ label, value }: { label: string; value?: string | number | null | undefined }) {
  if (!value) return null
  return (
    <>
      <dt>{label}</dt>
      <dd>{String(value)}</dd>
    </>
  )
}
