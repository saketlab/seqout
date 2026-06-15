export const shellEscapeSingleQuotes = (value: string): string =>
  `'${value.replace(/'/g, `'"'"'`)}'`;

export const buildCurlCommand = (url: string): string =>
  `curl -O ${shellEscapeSingleQuotes(url)}`;

export const buildSupplementaryDownloadScript = (
  items: { browserDownloadUrl: string }[],
): string => {
  if (items.length === 0) return "";
  return `curl -L -C - --retry 10 --retry-delay 5 --retry-all-errors --fail ${items
    .map((item) => `-O ${shellEscapeSingleQuotes(item.browserDownloadUrl)}`)
    .join(" ")}`;
};
