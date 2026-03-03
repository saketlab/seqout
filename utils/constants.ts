export const SITE_URL = "https://seqout.org";

let SERVER_URL = "/api";
if (process.env.NEXT_PUBLIC_SERVER_URL) {
  SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;
} else if (process.env.NEXT_PUBLIC_ENVIRONMENT === "DEV") {
  SERVER_URL = `${SITE_URL}/api`;
}
export { SERVER_URL };
