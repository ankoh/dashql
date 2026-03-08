import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <div>
      <h1>Vite + Bazel (sandbox)</h1>
      <p>Built with js_binary, no no-sandbox.</p>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
