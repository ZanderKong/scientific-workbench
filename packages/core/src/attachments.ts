/** Dedicated attachment links are plain Markdown in files, inline tokens in supported editors. */
export function fileLink(fileId: string, name: string): string {
  return `[${name.replace(/[\\\[\]]/g, "\\$&").replace(/\r?\n/g, " ")}](swb-file:${fileId})`;
}
export function fileLinks(text: string) {
  const result: {
    id: string;
    name: string;
    raw: string;
    start: number;
    end: number;
  }[] = [];
  const pattern =
    /\[((?:\\[\\\[\]]|[^\]\\\r\n])*)\]\(swb-file:([A-Za-z0-9_-]+)\)/g;
  for (const match of text.matchAll(pattern))
    result.push({
      id: match[2],
      name: match[1].replace(/\\([\\\[\]])/g, "$1"),
      raw: match[0],
      start: match.index!,
      end: match.index! + match[0].length,
    });
  return result;
}
