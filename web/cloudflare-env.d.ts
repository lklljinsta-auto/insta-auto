declare namespace Cloudflare {
  interface Env {
    META_DISCOVERY_ACCESS_TOKEN?: string;
    META_DISCOVERY_IG_ID?: string;
    CONSOLE_SECOND_ADMIN_EMAIL?: string;
    CONSOLE_SHARED_WORKSPACE?: string;
    CONSOLE_OWNER_EMAIL?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
