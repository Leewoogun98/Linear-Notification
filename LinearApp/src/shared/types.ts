export type Category = "mention" | "comment" | "assigned" | "projectUpdate";
export const ALL_CATEGORIES: Category[] = ["mention", "comment", "assigned", "projectUpdate"];

export interface Identity {
  id: string;
  name: string;
}

export interface Settings {
  relayUrl: string;
  sessionToken: string;
  me: Identity;
  enabledCategories: Category[];
}

export const DEFAULT_SETTINGS: Settings = {
  relayUrl: "wss://linear-noti-relay.bome00519.workers.dev",
  sessionToken: "",
  me: { id: "", name: "" },
  enabledCategories: ["mention", "comment", "assigned", "projectUpdate"],
};

export interface StoredNotification {
  id: string;
  category: Category;
  title: string;
  body: string;
  issueUrl?: string;
  identifier?: string;
  receivedAt: number;
  read: boolean;
}
