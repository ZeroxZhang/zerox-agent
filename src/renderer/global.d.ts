import type { BuildingAgentApi } from "../preload";

declare global {
  interface Window {
    buildingAgent?: BuildingAgentApi;
  }
}

export {};
