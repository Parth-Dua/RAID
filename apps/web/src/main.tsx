import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { LandingPage } from "./pages/LandingPage.js";
import { RoomPage } from "./pages/RoomPage.js";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/r/:code" element={<RoomPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
