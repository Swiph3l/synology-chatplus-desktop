const PAGE_SIZE = 200;
const MAX_PAGES = 20;
const MAX_CHANNELS = PAGE_SIZE * MAX_PAGES;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const opaqueId = /^[a-z0-9]{26}$/;
const mentionFields = [
  "mention_count",
  "mention_count_root",
  "urgent_mention_count",
] as const;
const teamFields = [
  "msg_count",
  "msg_count_root",
  "mention_count",
  "mention_count_root",
  "thread_count",
  "thread_mention_count",
  "thread_urgent_mention_count",
] as const;

export interface MattermostReadZeroOptions {
  base: URL;
  fetch: typeof globalThis.fetch;
  signal: AbortSignal;
}

interface MemberState {
  messages: number;
  roots: number;
}

function invalid(): never {
  throw new Error("Mattermost read state is unavailable.");
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid();
  return value as Record<string, unknown>;
}

function id(value: unknown): string {
  if (typeof value !== "string" || !opaqueId.test(value)) invalid();
  return value;
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid();
  return value as number;
}

function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}

async function json(
  url: URL,
  fetch: typeof globalThis.fetch,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) invalid();
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal,
  });
  const length = response.headers.get("content-length");
  if (
    signal.aborted ||
    response.status !== 200 ||
    response.redirected ||
    (response.url !== "" && response.url !== url.href) ||
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json" ||
    (length !== null &&
      (!/^[0-9]+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) ||
    response.body === null
  ) {
    void response.body?.cancel().catch(() => {});
    invalid();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let complete = false;
  let text = "";
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) invalid();
      const chunk = await reader.read();
      if (signal.aborted) invalid();
      if (chunk.done) {
        complete = true;
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) invalid();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    signal.removeEventListener("abort", abort);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function teamZero(value: unknown, expected: ReadonlySet<string>): void {
  const rows = array(value, MAX_CHANNELS);
  if (rows.length !== expected.size) invalid();
  const seen = new Set<string>();
  for (const raw of rows) {
    const row = record(raw);
    const team = row.team_id === "" ? "" : id(row.team_id);
    if (!expected.has(team) || seen.has(team)) invalid();
    seen.add(team);
    if (teamFields.some((field) => count(row[field]) !== 0)) invalid();
  }
}

// Swiph3l: These documented GETs return read metadata, not posts. Never read or
// export authentication cookies/tokens, or retain channel names/header fields.
export async function verifyMattermostReadZero({
  base,
  fetch,
  signal,
}: MattermostReadZeroOptions): Promise<boolean | null> {
  try {
    const root = new URL(base.href);
    if (
      !["http:", "https:"].includes(root.protocol) ||
      root.username ||
      root.password ||
      root.search ||
      root.hash
    )
      invalid();
    if (!root.pathname.endsWith("/")) root.pathname += "/";
    const api = (path: string) => new URL(`api/v4/${path}`, root);
    const endpoint = (path: string) => api(`users/me/${path}`);
    const get = (url: URL) => json(url, fetch, signal);
    const primaryReads = async () => {
      // Swiph3l: In audited 11.7.2, GetReplica uses the primary without a license.
      // Replica-backed zeros can predate an arrival; other versions/topologies are
      // unknown. Recheck these public fields after every complete count snapshot.
      const config = record(await get(api("config/client?format=old")));
      if (config.Version !== "11.7.2") invalid();
      const license = record(await get(api("license/client?format=old")));
      if (license.IsLicensed !== "false") invalid();
    };
    await primaryReads();
    const members = new Map<string, MemberState>();
    let user: string | undefined;
    let terminalPage = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = endpoint("channel_members");
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(PAGE_SIZE));
      const rows = array(await get(url), PAGE_SIZE);
      for (const raw of rows) {
        const row = record(raw);
        const channel = id(row.channel_id);
        const owner = id(row.user_id);
        if (members.has(channel) || (user !== undefined && user !== owner))
          invalid();
        user = owner;
        const messages = count(row.msg_count);
        const roots = count(row.msg_count_root);
        if (
          roots > messages ||
          mentionFields.some((field) => count(row[field]) !== 0)
        )
          invalid();
        members.set(channel, { messages, roots });
      }
      if (rows.length < PAGE_SIZE) {
        terminalPage = true;
        break;
      }
    }
    if (!terminalPage || members.size === 0) invalid();

    // Swiph3l: Fetch totals after memberships, so a newer message cannot match
    // an older fully-read member counter. Muted channels need this raw comparison:
    // the convenient /unread endpoints deliberately hide their ordinary messages.
    const channels = array(await get(endpoint("channels")), MAX_CHANNELS);
    // Swiph3l: Memberships can outlive archived channels. A missing live row is
    // unknown; never guess that an unmatched membership is safe to ignore.
    if (channels.length !== members.size) invalid();
    const seen = new Set<string>();
    const teams = new Set<string>();
    for (const raw of channels) {
      const row = record(raw);
      const channel = id(row.id);
      const team = row.team_id === "" ? "" : id(row.team_id);
      const direct = row.type === "D" || row.type === "G";
      if (
        (!direct && row.type !== "O" && row.type !== "P") ||
        direct !== (team === "") ||
        count(row.delete_at) !== 0 ||
        seen.has(channel)
      )
        invalid();
      seen.add(channel);
      const member = members.get(channel);
      const messages = count(row.total_msg_count);
      const roots = count(row.total_msg_count_root);
      if (
        member === undefined ||
        roots > messages ||
        messages !== member.messages ||
        roots !== member.roots
      )
        invalid();
      teams.add(team);
    }
    const nonemptyTeams = new Set([...teams].filter((team) => team !== ""));
    const excluded = nonemptyTeams.values().next().value;
    if (excluded === undefined) invalid();
    const unread = endpoint("teams/unread");
    unread.searchParams.set("include_collapsed_threads", "true");
    teamZero(await get(unread), nonemptyTeams);

    // Swiph3l: An omitted exclude_team means TeamId != "", excluding all DM/GM.
    // A second documented request excluding a real team covers that blank group;
    // union both complete responses, including followed-thread counters.
    unread.searchParams.set("exclude_team", excluded);
    const remainder = new Set(teams);
    remainder.delete(excluded);
    teamZero(await get(unread), remainder);
    await primaryReads();
    return signal.aborted ? null : true;
  } catch {
    // Authentication, partial pagination, malformed metadata and cancellation
    // are all unknown; none may manufacture a provider-wide read zero.
    return null;
  }
}
