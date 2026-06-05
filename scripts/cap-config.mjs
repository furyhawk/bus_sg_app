/**
 * Writes capacitor.config.json with the correct androidScheme for the given mode.
 *   node scripts/cap-config.mjs dev   -> http  (emulator, no mixed-content issues)
 *   node scripts/cap-config.mjs prod  -> https (production, secure)
 */
import { writeFileSync } from "fs";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "prod") {
  console.error("Usage: node scripts/cap-config.mjs <dev|prod>");
  process.exit(1);
}

const config = {
  appId: "com.bussg.app",
  appName: "Bus SG App",
  webDir: "build",
  bundledWebRuntime: false,
  server: {
    androidScheme: mode === "dev" ? "http" : "https"
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

writeFileSync("capacitor.config.json", JSON.stringify(config, null, 2) + "\n");
console.log(`capacitor.config.json written for ${mode} (androidScheme: ${config.server.androidScheme})`);
