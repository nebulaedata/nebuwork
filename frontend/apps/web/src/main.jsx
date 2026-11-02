import './features/services/ServiceConsent.jsx';
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";
import "./form-controls.css";
import "./layout-overrides.css";
import "./shared/icons.js";
import "./data/state.js";
import "./services/httpApi.js";
import "./features/workbench/view.js";
import "./features/projects/listView.js";
import "./features/projects/detailView.js";
import "./features/agents/view.js";
import "./features/workflows/view.jsx";
import "./features/tasks/AgentTask.jsx";
import "./features/settings/view.js";
import "./features/knowledge/detailView.jsx";
import "./features/plaza/view.js";
import "./features/auth/view.js";

document.documentElement.dataset.theme = localStorage.getItem("ah-theme") || "light";

createRoot(document.getElementById("root")).render(<App />);
