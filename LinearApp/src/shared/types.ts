export type FilterKind = "team" | "project" | "label" | "assignee" | "mentionsMe" | "keyword";

export interface FilterCondition {
  kind: FilterKind;
  value?: string; // mentionsMe 외에는 비교 대상 문자열
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  eventTypes: string[];   // 예: ["Issue","Comment"] — 비어있으면 모든 타입
  actions: string[];      // 예: ["create","update"] — 비어있으면 모든 액션
  filters: FilterCondition[]; // 모두 만족해야 매칭(AND)
}

export interface Identity {
  id: string;   // 내 Linear user id (assignee 비교용)
  name: string; // 멘션 매칭용 표시 이름/핸들
}

export interface Settings {
  relayUrl: string;   // 예: wss://linear-noti-relay.<account>.workers.dev
  authToken: string;
  me: Identity;
  rules: Rule[];
}

export const DEFAULT_SETTINGS: Settings = {
  relayUrl: "",
  authToken: "",
  me: { id: "", name: "" },
  rules: [],
};
