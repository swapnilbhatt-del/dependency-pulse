"use client";

import { useState } from "react";

export function CopyMarkdownButton({ markdown }: { markdown: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(markdown);
            setState("copied");
          } catch {
            setState("failed");
          }
          setTimeout(() => setState("idle"), 3000);
        }}
        data-testid="copy-markdown"
      >
        Copy as Markdown
      </button>
      <span aria-live="polite" className="text-xs text-ink-3">
        {state === "copied" ? "Copied. Paste it into your team channel." : state === "failed" ? "Copy failed; select the table text instead." : ""}
      </span>
    </span>
  );
}
