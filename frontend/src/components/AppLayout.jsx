import React from "react";
import Navbar from "./Navbar";

const AppLayout = ({ children, maxWidth = "max-w-6xl" }) => (
  <div className="min-h-screen bg-canvas">
    <Navbar />
    <main className="lg:pl-64">
      <div className={`mx-auto w-full ${maxWidth} px-4 py-6 sm:px-6 lg:px-8 lg:py-8`}>
        {children}
      </div>
    </main>
  </div>
);

export default AppLayout;
