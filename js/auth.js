import { supabase } from './supabase.js';

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** 'owner' | 'staff' | null. The UI uses this to hide controls; the
 *  database enforces the same rules independently. */
export async function getRole() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('profiles').select('role').eq('id', session.user.id).single();
  if (error) return null;
  return data.role;
}
