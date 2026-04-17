/** Nome foglio in notazione A1 (gestisce spazi e apostrofi). */
export function formatSheetRange(sheetTitle: string, a1Suffix = "A:Z"): string {
  const safe =
    /[^A-Za-z0-9_]/.test(sheetTitle) || /\s/.test(sheetTitle)
      ? `'${sheetTitle.replace(/'/g, "''")}'`
      : sheetTitle;
  return `${safe}!${a1Suffix}`;
}
