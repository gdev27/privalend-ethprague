import { getAccessToken } from "./orbitport-auth";

(async () => {
  try {
    const token = await getAccessToken();
    console.log("Orbitport auth works. Token length:", token.length);
    console.log("First 20 chars:", token.slice(0, 20) + "...");
  } catch (e) {
    console.error("Auth failed:", e);
    process.exit(1);
  }
})();
