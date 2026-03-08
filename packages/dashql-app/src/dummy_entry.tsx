import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <div>
      <h1>DashQL</h1>
      <p>Bazel Vite dummy entry (sandbox).</p>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
