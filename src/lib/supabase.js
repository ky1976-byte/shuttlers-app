import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key) : null;

/** Call a Postgres function and throw a readable error on failure. */
export async function rpc(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(cleanError(error.message));
  return data;
}

function cleanError(msg) {
  // Postgres RAISE messages arrive verbatim; strip noise from other errors.
  return (msg || "Something went wrong.").replace(/^.*?: /, (m) =>
    m.includes("duplicate key") ? "" : ""
  ) || msg;
}
