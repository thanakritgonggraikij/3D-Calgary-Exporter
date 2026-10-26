import React from "react"
import { createRoot } from "react-dom/client"
import App from "./src/App"
import "cesium/Build/Cesium/Widgets/widgets.css"
import "./src/index.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)