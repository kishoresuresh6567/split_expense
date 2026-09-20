// Injected by the browser runner only; never copied into the deployed app.
(() => {
  const key = 'gather-test-cloud';
  const owner = {id:'00000000-0000-4000-8000-000000000001',email:'owner@example.com'};
  let account = JSON.parse(sessionStorage.getItem('gather-test-account') || 'null');
  let callback;
  const load = () => JSON.parse(sessionStorage.getItem(key) || '[]');
  const write = rows => sessionStorage.setItem(key, JSON.stringify(rows));
  const fixture = {
    configured:true,
    session:async () => account ? {user:account} : null,
    watch:fn => { callback = fn; },
    signIn:async () => {
      if (fixture.failSignIn) throw Error('Google sign-in is unavailable.');
      fixture.setAccount(owner);
    },
    signOut:async () => fixture.setAccount(null),
    myName:async () => account ? sessionStorage.getItem(`gather-test-name-${account.id}`) : null,
    setMyName:async name => {
      if (!account) throw Error('Sign in first.');
      sessionStorage.setItem(`gather-test-name-${account.id}`, name);
      return name;
    },
    memberNames:async gid => {
      const row = load().find(item => item.id === gid);
      if (!row) return [];
      return row.document.members.flatMap(member => {
        const user = [owner, account].find(item => item?.email === member.email);
        const name = user && sessionStorage.getItem(`gather-test-name-${user.id}`);
        return name ? [{email:member.email, display_name:name}] : [];
      });
    },
    setAccount(user) {
      account = user; sessionStorage.setItem('gather-test-account',JSON.stringify(user));
      callback?.(user ? {user} : null);
    },
    owner,
    failNext:false,
    groups:async () => load().filter(row => row.owner_id === account?.id || row.document.members.some(member => member.email === account?.email)),
    editLink:async (gid, replace = false) => {
      const links = JSON.parse(sessionStorage.getItem('gather-test-links') || '{}');
      if (!links[gid] || replace) links[gid] = crypto.randomUUID().replaceAll('-','') + crypto.randomUUID().replaceAll('-','');
      sessionStorage.setItem('gather-test-links',JSON.stringify(links));
      return links[gid];
    },
    readLink:async token => {
      if (!account) throw Error('Sign in with Google first.');
      const links = JSON.parse(sessionStorage.getItem('gather-test-links') || '{}');
      const gid = Object.keys(links).find(id => links[id] === token);
      const row = load().find(item => item.id === gid);
      if (!row) throw Error('This group link is invalid or has been replaced.');
      if (row.owner_id !== account.id && !row.document.members.some(member => member.email === account.email)) throw Error('Group unavailable. Sign in with an email listed in this group.');
      return {id:row.id,document:row.document,version:row.version};
    },
    saveLink:async (token, doc, version) => {
      const row = await fixture.readLink(token);
      if (row.id !== doc.id) throw Error('Invalid group.');
      return fixture.save(row.id,doc,version);
    },
    create:async document => {
      await new Promise(resolve => setTimeout(resolve,20));
      const row = {id:document.id,owner_id:account.id,version:1,document};
      write([...load(), row]); return structuredClone(row);
    },
    save:async (id, document, version) => {
      await new Promise(resolve => setTimeout(resolve,20));
      if (fixture.failNext) { fixture.failNext = false; throw Error('Group changed. Refresh and try again.'); }
      const rows = load(), row = rows.find(row => row.id === id);
      if (row.version !== version) throw Error('Group changed. Refresh and try again.');
      Object.assign(row,{document,version:version+1}); write(rows); return structuredClone(row);
    },
    remove:async id => {
      await new Promise(resolve => setTimeout(resolve,20));
      write(load().filter(row => row.id !== id));
    }
  };
  window.__testCloud = fixture;
  Object.defineProperty(window,'Cloud',{configurable:true,get:() => fixture,set:() => {}});
})();
