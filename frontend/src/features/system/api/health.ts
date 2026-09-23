import { getHealth } from "@/shared/api/generated";
import { unwrap } from "@/shared/api/errors";

export async function loadHealth() { return unwrap(await getHealth()); }
