export class BpsApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string
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
    return error.message;
  }
  if (error instanceof BpsApiError) {
    return `Error dari BPS API (${error.statusCode ?? "unknown"}): ${error.message}`;
  }
  if (error instanceof Error) {
    return `Terjadi kesalahan: ${error.message}`;
  }
  return "Terjadi kesalahan yang tidak diketahui.";
}
