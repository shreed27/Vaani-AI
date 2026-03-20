import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Vaani Backend is running!" });
  });

  // Proxy for AI tools (simulating a real backend brain)
  app.post("/api/ai/tools", async (req, res) => {
    const { name, args, userId, role } = req.body;
    console.log(`Backend executing tool: ${name} for ${userId}`);
    
    // In a real production app, we'd do the Firebase calls here
    // For now, we'll let the frontend handle the direct DB access 
    // but this endpoint can be used for more complex logic.
    res.json({ status: "received", name, args });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Vaani Backend running on http://localhost:${PORT}`);
  });
}

startServer();
