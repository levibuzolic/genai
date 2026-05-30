export function jsonEqual<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function replaceEqualJson<T>(current: T, next: T): T {
  return jsonEqual(current, next) ? current : next
}
