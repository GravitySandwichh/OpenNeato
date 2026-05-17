import { render } from "preact";
import { App } from "./app";
import "./style.css";

declare const __DEMO_BUILD__: boolean;

if (__DEMO_BUILD__) {
    void import("./analytics").then(({ startAnalytics }) => startAnalytics());
}

const root = document.getElementById("app");
if (root) render(<App />, root);
