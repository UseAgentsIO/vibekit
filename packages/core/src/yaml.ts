import { stringify } from "yaml";

export function stringifyYaml(data: unknown): string {
  const text = stringify(data, {
    lineWidth: 0,
  });
  return text.endsWith("\n") ? text : `${text}\n`;
}
