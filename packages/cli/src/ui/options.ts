export interface MenuOption<T> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
  readonly id?: string;
}

export function filterOptions<T>(
  options: ReadonlyArray<MenuOption<T>>,
  query: string,
): MenuOption<T>[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [...options];
  }
  return options.filter((option) => {
    const id = option.id ?? (typeof option.value === "string" ? option.value : "");
    return (
      option.label.toLowerCase().includes(needle) ||
      id.toLowerCase().includes(needle) ||
      (option.hint?.toLowerCase().includes(needle) ?? false)
    );
  });
}

export function wrapIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (index + length) % length;
}

export function defaultMenuLimit(rows = process.stdout.rows ?? 24, linesPerItem = 1): number {
  const raw = Math.max(6, Math.min(12, rows - 6));
  if (linesPerItem <= 1) {
    return raw;
  }
  return Math.max(4, Math.floor(raw / linesPerItem));
}

export function windowItems<T>(
  items: readonly T[],
  cursor: number,
  limit: number,
): { readonly items: T[]; readonly start: number } {
  if (limit <= 0 || items.length <= limit) {
    return { items: [...items], start: 0 };
  }
  const maxStart = items.length - limit;
  const start = Math.min(maxStart, Math.max(0, cursor - Math.floor(limit / 2)));
  return { items: items.slice(start, start + limit), start };
}
