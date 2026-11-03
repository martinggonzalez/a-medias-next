import { coupleMembers, type CoupleMemberId } from "./domain";

export const CURRENT_MEMBER_KEY = "a-medias:registered-by:v1";

export function loadCurrentMember(storage: Pick<Storage, "getItem">): CoupleMemberId {
  try {
    const stored = storage.getItem(CURRENT_MEMBER_KEY);
    return coupleMembers.find((person) => person.id === stored)?.id ?? "adela";
  } catch {
    return "adela";
  }
}
