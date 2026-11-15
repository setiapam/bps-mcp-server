export class BpsApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
    /** Value of the Retry-After header, when BPS sends one. */
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "BpsApiError";
  }
}

export class BpsNotFoundError extends BpsApiError {
  constructor(resource: string) {
    super(`Data tidak ditemukan: ${resource}`, 404);
    this.name = "BpsNotFoundError";
  }
}

export class BpsAuthError extends BpsApiError {
  constructor() {
    super("Autentikasi gagal. Periksa BPS_API_KEY Anda.", 401);
    this.name = "BpsAuthError";
  }
}

export function formatErrorForUser(error: unknown): string {
  if (error instanceof BpsAuthError) {
    return "Autentikasi gagal. Pastikan BPS_API_KEY sudah benar. Dapatkan API key di https://webapi.bps.go.id";
  }
  if (error instanceof BpsNotFoundError) {
    return humanizeNotFound(error.message);
  }
  if (error instanceof BpsApiError) {
    if (error.statusCode === 429) {
      return (
        "Batas permintaan BPS API tercapai (HTTP 429). Tunggu 1–2 menit lalu coba lagi. " +
        "Gunakan cache atau kurangi jumlah panggilan beruntun. " +
        "Jika tetap terjadi, key Anda mungkin sedang dibatasi sementara oleh BPS."
      );
    }
    return `Error dari BPS API (${error.statusCode ?? "unknown"}): ${error.message}`;
  }
  if (error instanceof Error) {
    return `Terjadi kesalahan: ${error.message}`;
  }
  return "Terjadi kesalahan yang tidak diketahui.";
}

const MODEL_LABELS: Record<string, string> = {
  statictable: "tabel statis",
  publication: "publikasi",
  pressrelease: "berita resmi statistik",
  indicators: "indikator strategis",
  var: "variabel",
  subject: "subjek",
  news: "berita",
  infographic: "infografis",
  glossary: "glosarium",
  data: "data",
};

/**
 * Turn internal resource keys such as
 * `list:indicators:{"domain":"3578","lang":"ind"}` into a sentence an agent
 * (and a human) can act on, instead of leaking the endpoint shape.
 */
export function humanizeNotFound(message: string): string {
  const raw = message.replace(/^Data tidak ditemukan:\s*/i, "").trim();
  const match = /^(list|view):([a-z]+):(.*)$/i.exec(raw);
  if (!match) return `Data tidak ditemukan: ${raw}`;

  const [, , model, rest] = match;
  const label = MODEL_LABELS[model.toLowerCase()] ?? model;
  let details = "";
  try {
    const params = JSON.parse(rest) as Record<string, unknown>;
    const parts: string[] = [];
    if (params.domain) parts.push(`domain ${String(params.domain)}`);
    if (params.var) parts.push(`variabel ${String(params.var)}`);
    if (params.keyword) parts.push(`kata kunci "${String(params.keyword)}"`);
    if (params.id) parts.push(`id ${String(params.id)}`);
    details = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  } catch {
    if (rest.trim()) details = ` (${rest.trim()})`;
  }

  return `BPS tidak menyediakan ${label}${details}`;
}
