export type Category = "mention" | "projectUpdate" | "reaction";
export type PopupPosition = "center" | "top-right" | "top-left" | "bottom-right" | "bottom-left";
export const ALL_CATEGORIES: Category[] = ["mention", "projectUpdate", "reaction"];

export interface Identity {
  id: string;
  name: string;
  displayName: string;
}

export interface Settings {
  relayUrl: string;
  sessionToken: string;
  me: Identity;
  enabledCategories: Category[];
  muteOwnChanges: boolean;
  popupPosition: PopupPosition;
}

export const DEFAULT_SETTINGS: Settings = {
  relayUrl: "wss://linear-noti-relay.bome00519.workers.dev",
  sessionToken: "",
  me: { id: "", name: "", displayName: "" },
  enabledCategories: ["mention", "projectUpdate", "reaction"],
  muteOwnChanges: true,
  popupPosition: "center",
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
