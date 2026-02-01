import * as fs from "node:fs";
import { app, protocol } from "electron";

export function setupApp() {
  app.setName("nw_wrld");

  if (process.env.NODE_ENV === "test") {
    const testUserDataDirRaw = process.env.NW_WRLD_TEST_USER_DATA_DIR;
    if (typeof testUserDataDirRaw === "string") {
      const testUserDataDir = testUserDataDirRaw.trim();
      if (testUserDataDir) {
        try {
          fs.mkdirSync(testUserDataDir, { recursive: true });
          app.setPath("userData", testUserDataDir);
        } catch {}
      }
    }
  }

  protocol.registerSchemesAsPrivileged([
    {
      scheme: "nw-sandbox",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    {
      scheme: "nw-assets",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);

  if (process.platform === "darwin") {
    app.setAboutPanelOptions({
      applicationName: "nw_wrld",
      applicationVersion: app.getVersion(),
    });
  }

  app.commandLine.appendSwitch("max-webgl-contexts", "64");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-zero-copy");
}
