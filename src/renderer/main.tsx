import React from "react"
import { createRoot } from "react-dom/client"
import "./styles/globals.css"
import Providers from "./app/providers"
import MainWindow from "./app/modes/MainWindow"
import DocWindow from "./app/modes/DocWindow"

declare global {
  interface Window {
    __PLAND_POC__?: string
  }
}

window.__PLAND_POC__ = "react-shell"

function isDocWindow(): boolean {
  return new URLSearchParams(window.location.search).get("docwin") === "1"
}

const rootEl = document.getElementById("root")
if (!rootEl) {
  throw new Error("[renderer] missing #root element")
}

createRoot(rootEl).render(
  <React.StrictMode>
    <Providers>{isDocWindow() ? <DocWindow /> : <MainWindow />}</Providers>
  </React.StrictMode>,
)
