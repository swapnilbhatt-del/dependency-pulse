"use client";

import { useEffect } from "react";
import { IconPrint } from "@/components/icons";

/** Opens every <details> before printing so key changes appear on paper, then restores them. */
export function PrintButton() {
  useEffect(() => {
    const opened: HTMLDetailsElement[] = [];
    const before = () => {
      document.querySelectorAll("details:not([open])").forEach((d) => {
        (d as HTMLDetailsElement).open = true;
        opened.push(d as HTMLDetailsElement);
      });
    };
    const after = () => {
      opened.splice(0).forEach((d) => (d.open = false));
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return (
    <button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={() => window.print()} data-testid="print-button">
      <IconPrint />
      <span className="hidden sm:inline">Print</span>
      <span className="sr-only sm:hidden">Print this digest</span>
    </button>
  );
}
