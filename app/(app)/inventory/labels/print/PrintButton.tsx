"use client";

import { btn } from "@/components/ui";

export default function PrintButton() {
  return (
    <button className={`${btn.primary} no-print`} onClick={() => window.print()} type="button">
      Print labels
    </button>
  );
}
