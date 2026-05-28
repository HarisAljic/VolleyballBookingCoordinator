import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerRunRoutes } from "./routes/runs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

export function createApp() {
  const app = express();

  if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
  }

  app.disable("x-powered-by");
  app.use(express.json({ limit: "400kb" }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    if (/\.(js|html)$/i.test(req.path)) {
      res.setHeader("Cache-Control", "no-store, max-age=0");
    }
    next();
  });

  registerAuthRoutes(app);
  registerRunRoutes(app);

  app.use(
    express.static(rootDir, {
      index: ["index.html"],
      extensions: ["html"],
    })
  );

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Server error." });
  });

  return app;
}
