export function normalizeServer(input: string): string {
  const value = input.trim();
  if (!/^https?:\/\//i.test(value) || /[\\\s]/.test(value))
    throw new Error("Enter a valid http:// or https:// server URL.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid server URL.");
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash)
    throw new Error(
      "Use a server URL without credentials, query parameters or fragments.",
    );
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  return url.href;
}
