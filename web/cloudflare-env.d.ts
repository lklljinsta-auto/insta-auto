declare namespace Cloudflare {
  interface Env {
    CONSOLE_SECOND_ADMIN_EMAIL?: string;
    CONSOLE_SHARED_WORKSPACE?: string;
    CONSOLE_OWNER_EMAIL?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
