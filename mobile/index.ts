import { registerRootComponent } from "expo";
import App from "./App";

// The development client requests the project entry module directly. Keeping
// this explicit makes local reloads use the same app root as store builds.
registerRootComponent(App);
