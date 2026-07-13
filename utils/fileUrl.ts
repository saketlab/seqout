const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function fileUrl(path: string): string {
  return HAS_SCHEME.test(path) ? path : `https://${path}`;
}
