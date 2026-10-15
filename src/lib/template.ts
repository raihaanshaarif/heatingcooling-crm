/** Replace {{placeholders}} in admin-editable email and SMS templates. Unknown ones become "". */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? "" : String(v);
  });
}
