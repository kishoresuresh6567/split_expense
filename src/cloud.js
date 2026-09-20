import {createClient} from '@supabase/supabase-js';

const client = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
async function result(request) {
  const {data, error} = await request;
  if (error) throw error;
  return data;
}
const rpc = (name, args, single = false) => {
  const request = client.rpc(`gather_${name}`, args);
  return result(single ? request.single() : request);
};
window.Cloud = {
  configured: Boolean(client),
  async session() { return (await result(client.auth.getSession())).session; },
  watch(callback) { client.auth.onAuthStateChange((event, session) => callback(session, event)); },
  signIn() {
    return result(client.auth.signInWithOAuth({provider:'google', options:{
      redirectTo:location.origin + location.pathname,
      queryParams:{prompt:'select_account'}
    }}));
  },
  signOut() { return result(client.auth.signOut({scope:'local'})); },
  myName() { return rpc('my_name', {}); },
  setMyName(new_name) { return rpc('set_my_name', {new_name}); },
  memberNames(gid) { return rpc('member_names', {gid}); },
  groups() { return result(client.from('gather_groups').select('*').order('created_at')); },
  create(doc) { return rpc('create_group', {doc}, true); },
  save(gid, doc, expected_version) { return rpc('save_group', {gid, doc, expected_version}, true); },
  remove(gid, expected_version) { return rpc('delete_group', {gid, expected_version}); },
  readLink(link_token) { return rpc('read_link', {link_token}, true); },
  saveLink(link_token, doc, expected_version) { return rpc('save_link', {link_token, doc, expected_version}, true); }
};
